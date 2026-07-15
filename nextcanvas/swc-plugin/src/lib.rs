//! nextcanvas SWC plugin — the SWC-native source-location stamp.
//!
//! Stamps `data-loc="<absFile>:<line>:<col>"` onto JSX elements the write-back
//! server can edit. Stampable tags:
//!   - **host** (lowercase) elements — stamp lands on the DOM node directly
//!   - **plain-identifier components** (capitalized, e.g. `<Reveal as="h2">`) —
//!     for *text* / bound-text, children are wrapped in a stamped `<span>` so the
//!     stamp reaches the DOM even when the component does not forward props
//!     (Reveal, ConciergeTrigger, …). Attr stamps still go on the component
//!     (best-effort; needs `{...rest}` forwarding).
//!   - **member tags** (`motion.h1`, `motion.p`, …) — stamped in place; Motion
//!     (and similar) forward unknown DOM attrs to the host element.
//!
//! An element qualifies when it has ANY of:
//!   - one or more non-whitespace `JSXText` direct children (editable text),
//!     whether plain (`<h1>Hello</h1>`) or mixed with inline child elements
//!     (`<p>Hello <strong>world</strong>!</p>`), OR
//!   - a single **bound-text** child — see below, OR
//!   - at least one editable string-literal / bound-identifier attribute.
//!
//! **Bound text.** An element whose *only* non-whitespace child is a single
//! `{expression}` is stamped as `data-nc-text-bound` when the expression is:
//!   - a `{member.chain}` of plain identifiers (`{speaker.name}`, `{cfg.title}`)
//!   - a `{a ?? b}` / `{a || b}` of those same shapes (server value-matches each
//!     side — covers `{s.name ?? s.role}`)
//!   - a bare `{identifier}` that names either:
//!       (1) the element parameter of an enclosing `.map`/`.flatMap` callback, or
//!       (2) a parameter of an enclosing **capitalized** function/component
//!           (`function Row({ q }) { … <span>{q}</span> }`) — the server
//!           prop-drills to the call site (`q={f.q}` inside `faqs.map`)
//! Anything more complex — computed `{items[i].x}`, a call `{fn().y}`, or text
//! mixed with an expression (`Hi {name}`) — stays unstamped.
//!
//! Editable attributes are emitted split by kind:
//!   - `data-nc-attrs` — string-literal attrs (`href="/x"`)
//!   - `data-nc-bound` — bound simple-identifier attrs (`href={GITHUB}`)
//!
//! Because it runs inside SWC, it works under **both** the webpack (next-swc)
//! and Turbopack pipelines. Wired via `experimental.swcPlugins` (injected by
//! `withCanvas`), dev-only.

use swc_core::common::{SyntaxContext, SourceMapper, DUMMY_SP};
use swc_core::ecma::ast::{
    BinExpr, BinaryOp, CallExpr, Callee, Expr, FnDecl, FnExpr, Ident, IdentName, JSXAttr,
    JSXAttrName, JSXAttrOrSpread, JSXAttrValue, JSXClosingElement, JSXElement, JSXElementChild,
    JSXElementName, JSXExpr, JSXMemberExpr, JSXObject, JSXOpeningElement, MemberProp, ObjectPatProp,
    Param, Pat, Program, Str, VarDeclarator,
};
use swc_core::ecma::visit::{VisitMut, VisitMutWith};
use swc_core::plugin::metadata::TransformPluginMetadataContextKind;
use swc_core::plugin::plugin_transform;
use swc_core::plugin::proxies::{PluginSourceMapProxy, TransformPluginProgramMetadata};

struct DataLocStamper {
    filename: String,
    source_map: PluginSourceMapProxy,
    /// Stack of identifier names currently bound as the *element* parameter of an
    /// enclosing `.map`/`.flatMap` callback (`truths.map((t, i) => …)` pushes
    /// `t`). A sole bare `{ident}` text child is stamped when its identifier is
    /// on this stack — i.e. it's a mapped-array element the server can rewrite
    /// by value.
    map_params: Vec<String>,
    /// Stack of param-binding name sets for enclosing **capitalized** functions
    /// (`function Row({ q, a })`, `const SessionCard = ({ session }) => …`).
    /// Bare `{q}` / `{session.title}`'s base can resolve through prop-drill on
    /// the server. Pushed as a flat list of binding names per scope.
    component_params: Vec<Vec<String>>,
}

/// Names that are almost never editable source copy when used as bare `{ident}`
/// props — leave them unstamped so the overlay doesn't offer a bouncing edit.
const SKIP_BARE_PROPS: &[&str] = &[
    "children",
    "className",
    "key",
    "ref",
    "props",
    "style",
    "dangerouslySetInnerHTML",
];

fn is_component_name(name: &str) -> bool {
    name.chars()
        .next()
        .map(|c| c.is_uppercase())
        .unwrap_or(false)
}

fn is_capitalized_tag(name: &JSXElementName) -> bool {
    match name {
        JSXElementName::Ident(id) => is_component_name(&id.sym),
        _ => false,
    }
}

/// Host (`div`), plain Ident component (`Reveal`), or one-level member tag
/// (`motion.h1`). Nested members (`Foo.Bar.Baz`) and namespaced tags stay out.
fn is_stampable_tag(name: &JSXElementName) -> bool {
    match name {
        JSXElementName::Ident(_) => true,
        JSXElementName::JSXMemberExpr(JSXMemberExpr { obj, .. }) => {
            matches!(obj, JSXObject::Ident(_))
        }
        JSXElementName::JSXNamespacedName(_) => false,
    }
}

/// Binding names introduced by a pattern — plain `t`, or destructured `{ q, a }`
/// / `{ session: s }` (value side).
fn binding_names_from_pat(pat: &Pat) -> Vec<String> {
    match pat {
        Pat::Ident(b) => vec![b.id.sym.to_string()],
        Pat::Object(obj) => obj
            .props
            .iter()
            .flat_map(|p| match p {
                ObjectPatProp::Assign(a) => vec![a.key.id.sym.to_string()],
                ObjectPatProp::KeyValue(kv) => binding_names_from_pat(&kv.value),
                ObjectPatProp::Rest(_) => vec![],
            })
            .collect(),
        Pat::Assign(a) => binding_names_from_pat(&a.left),
        _ => vec![],
    }
}

fn binding_names_from_params(params: &[Pat]) -> Vec<String> {
    params.iter().flat_map(binding_names_from_pat).collect()
}

fn binding_names_from_fn_params(params: &[Param]) -> Vec<String> {
    params
        .iter()
        .flat_map(|p| binding_names_from_pat(&p.pat))
        .collect()
}

/// The first parameter of a `.map`/`.flatMap` callback, when it's a plain
/// identifier binding (`(t, i) => …`). Destructuring params (`({id}) => …`) and
/// index-only positions return None — only the element binding is editable via
/// the map-param gate (destructured map params still work as member chains
/// `{id.x}` via the component/map resolution on the server when inlined).
fn first_ident_pat(params: &[Pat]) -> Option<String> {
    match params.first() {
        Some(Pat::Ident(b)) => Some(b.id.sym.to_string()),
        _ => None,
    }
}
fn first_ident_param(params: &[Param]) -> Option<String> {
    match params.first().map(|p| &p.pat) {
        Some(Pat::Ident(b)) => Some(b.id.sym.to_string()),
        _ => None,
    }
}

/// True when the element has at least one non-whitespace static JSXText direct
/// child (text the write-back server can rewrite) and **no** direct
/// `{expression}` / spread child. Plain static text and text mixed with inline
/// child elements both qualify; a direct bound value disqualifies the element.
fn has_editable_text(children: &[JSXElementChild]) -> bool {
    let mut has_text = false;
    for child in children {
        match child {
            JSXElementChild::JSXText(t) => {
                if !t.value.trim().is_empty() {
                    has_text = true;
                }
            }
            JSXElementChild::JSXExprContainer(_) | JSXElementChild::JSXSpreadChild(_) => {
                return false;
            }
            _ => {}
        }
    }
    has_text
}

/// A member-access chain of plain identifiers, rendered as a dotted path.
/// `speaker.name` → `Some("speaker.name")`. Returns `None` for computed/call/
/// optional-chain links.
fn member_path(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Ident(id) => Some(id.sym.to_string()),
        Expr::Member(m) => {
            let obj = member_path(&m.obj)?;
            let prop = match &m.prop {
                MemberProp::Ident(id) => id.sym.to_string(),
                _ => return None,
            };
            Some(format!("{}.{}", obj, prop))
        }
        _ => None,
    }
}

/// A single bound-text operand: member chain, or bare ident that is a live map
/// param / component prop (not a skipped reserved name).
fn bound_operand_path(
    expr: &Expr,
    map_params: &[String],
    component_params: &[Vec<String>],
) -> Option<String> {
    match expr {
        Expr::Member(_) => member_path(expr),
        Expr::Ident(id) => {
            let name = id.sym.to_string();
            if SKIP_BARE_PROPS.contains(&name.as_str()) {
                return None;
            }
            let in_map = map_params.contains(&name);
            let in_comp = component_params.iter().any(|s| s.contains(&name));
            if in_map || in_comp {
                Some(name)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// When the element's only non-whitespace child is a single `{expression}` the
/// server can rewrite, return the path (or `a??b` / `a||b` form) to stamp as
/// `data-nc-text-bound`.
fn editable_bound_text_expr(
    children: &[JSXElementChild],
    map_params: &[String],
    component_params: &[Vec<String>],
) -> Option<String> {
    let mut found: Option<String> = None;
    for child in children {
        match child {
            JSXElementChild::JSXText(t) => {
                if !t.value.trim().is_empty() {
                    return None;
                }
            }
            JSXElementChild::JSXExprContainer(c) => {
                if found.is_some() {
                    return None;
                }
                match &c.expr {
                    JSXExpr::Expr(e) => match &**e {
                        Expr::Member(_) | Expr::Ident(_) => {
                            found = Some(bound_operand_path(e, map_params, component_params)?);
                        }
                        Expr::Bin(BinExpr { op, left, right, .. })
                            if matches!(
                                op,
                                BinaryOp::NullishCoalescing | BinaryOp::LogicalOr
                            ) =>
                        {
                            let l = bound_operand_path(left, map_params, component_params)?;
                            let r = bound_operand_path(right, map_params, component_params)?;
                            let sep = if *op == BinaryOp::NullishCoalescing {
                                "??"
                            } else {
                                "||"
                            };
                            found = Some(format!("{}{}{}", l, sep, r));
                        }
                        _ => return None,
                    },
                    _ => return None,
                }
            }
            _ => return None,
        }
    }
    found
}

const EDITABLE_ATTRS: [&str; 6] = ["src", "href", "alt", "title", "placeholder", "aria-label"];

fn editable_string_attrs(attrs: &[JSXAttrOrSpread]) -> Vec<String> {
    attrs
        .iter()
        .filter_map(|a| match a {
            JSXAttrOrSpread::JSXAttr(attr) => {
                let name = match &attr.name {
                    JSXAttrName::Ident(id) => &*id.sym,
                    JSXAttrName::JSXNamespacedName(_) => return None,
                };
                if EDITABLE_ATTRS.contains(&name)
                    && matches!(attr.value, Some(JSXAttrValue::Str(_)))
                {
                    Some(name.to_string())
                } else {
                    None
                }
            }
            JSXAttrOrSpread::SpreadElement(_) => None,
        })
        .collect()
}

fn editable_bound_attrs(attrs: &[JSXAttrOrSpread]) -> Vec<String> {
    attrs
        .iter()
        .filter_map(|a| match a {
            JSXAttrOrSpread::JSXAttr(attr) => {
                let name = match &attr.name {
                    JSXAttrName::Ident(id) => &*id.sym,
                    JSXAttrName::JSXNamespacedName(_) => return None,
                };
                if !EDITABLE_ATTRS.contains(&name) {
                    return None;
                }
                match &attr.value {
                    Some(JSXAttrValue::JSXExprContainer(c)) => match &c.expr {
                        JSXExpr::Expr(e) if matches!(&**e, Expr::Ident(_)) => {
                            Some(name.to_string())
                        }
                        _ => None,
                    },
                    _ => None,
                }
            }
            JSXAttrOrSpread::SpreadElement(_) => None,
        })
        .collect()
}

fn already_stamped(attrs: &[JSXAttrOrSpread]) -> bool {
    attrs.iter().any(|a| match a {
        JSXAttrOrSpread::JSXAttr(attr) => match &attr.name {
            JSXAttrName::Ident(id) => &*id.sym == "data-loc",
            JSXAttrName::JSXNamespacedName(_) => false,
        },
        JSXAttrOrSpread::SpreadElement(_) => false,
    })
}

fn data_attr(name: &str, value: String) -> JSXAttrOrSpread {
    JSXAttrOrSpread::JSXAttr(JSXAttr {
        span: DUMMY_SP,
        name: JSXAttrName::Ident(IdentName::new(name.into(), DUMMY_SP)),
        value: Some(JSXAttrValue::Str(Str {
            span: DUMMY_SP,
            value: value.into(),
            raw: None,
        })),
    })
}

fn span_ident() -> Ident {
    Ident::new("span".into(), DUMMY_SP, SyntaxContext::empty())
}

/// Wrap `children` in `<span …attrs>…</span>` so a non-forwarding component still
/// exposes a stamped host node in the DOM. `data-loc` points at the *component's*
/// source location so write-back finds the original JSX in the source file.
fn wrap_children_in_span(
    children: Vec<JSXElementChild>,
    attrs: Vec<JSXAttrOrSpread>,
) -> JSXElementChild {
    let span_name = JSXElementName::Ident(span_ident());
    JSXElementChild::JSXElement(Box::new(JSXElement {
        span: DUMMY_SP,
        opening: JSXOpeningElement {
            name: span_name.clone(),
            span: DUMMY_SP,
            attrs,
            self_closing: false,
            type_args: None,
        },
        children,
        closing: Some(JSXClosingElement {
            span: DUMMY_SP,
            name: span_name,
        }),
    }))
}

impl VisitMut for DataLocStamper {
    /// Track `.map`/`.flatMap` callback element params so a bare `{ident}` text
    /// child nested inside is recognized as a mapped-array element.
    fn visit_mut_call_expr(&mut self, node: &mut CallExpr) {
        let mut pushed = false;
        if let Callee::Expr(callee) = &node.callee {
            if let Expr::Member(m) = &**callee {
                let is_map = matches!(&m.prop, MemberProp::Ident(id) if matches!(&*id.sym, "map" | "flatMap"));
                if is_map {
                    if let Some(first) = node.args.first() {
                        let name = match &*first.expr {
                            Expr::Arrow(a) => first_ident_pat(&a.params),
                            Expr::Fn(f) => first_ident_param(&f.function.params),
                            _ => None,
                        };
                        if let Some(name) = name {
                            self.map_params.push(name);
                            pushed = true;
                        }
                    }
                }
            }
        }
        node.visit_mut_children_with(self);
        if pushed {
            self.map_params.pop();
        }
    }

    /// `function Row({ q }) { … }` — push component param bindings when the
    /// function name is capitalized.
    fn visit_mut_fn_decl(&mut self, node: &mut FnDecl) {
        let mut pushed = false;
        if is_component_name(&node.ident.sym) {
            let names = binding_names_from_fn_params(&node.function.params);
            if !names.is_empty() {
                self.component_params.push(names);
                pushed = true;
            }
        }
        node.visit_mut_children_with(self);
        if pushed {
            self.component_params.pop();
        }
    }

    /// `const Row = function({ q }) { … }` (rare) — same gate via the outer
    /// VarDeclarator visit; FnExpr itself has no name, so we only push here when
    /// the function expression carries an inner name (`function Row(){}`).
    fn visit_mut_fn_expr(&mut self, node: &mut FnExpr) {
        let mut pushed = false;
        if let Some(id) = &node.ident {
            if is_component_name(&id.sym) {
                let names = binding_names_from_fn_params(&node.function.params);
                if !names.is_empty() {
                    self.component_params.push(names);
                    pushed = true;
                }
            }
        }
        node.visit_mut_children_with(self);
        if pushed {
            self.component_params.pop();
        }
    }

    /// `const SessionCard = ({ session }) => …` / `const Row = ({ q }) => …`.
    fn visit_mut_var_declarator(&mut self, node: &mut VarDeclarator) {
        let mut pushed = false;
        if let Pat::Ident(id) = &node.name {
            if is_component_name(&id.id.sym) {
                if let Some(init) = &node.init {
                    let names = match &**init {
                        Expr::Arrow(a) => Some(binding_names_from_params(&a.params)),
                        Expr::Fn(f) => Some(binding_names_from_fn_params(&f.function.params)),
                        _ => None,
                    };
                    if let Some(names) = names {
                        if !names.is_empty() {
                            self.component_params.push(names);
                            pushed = true;
                        }
                    }
                }
            }
        }
        node.visit_mut_children_with(self);
        if pushed {
            self.component_params.pop();
        }
    }

    fn visit_mut_jsx_element(&mut self, node: &mut JSXElement) {
        node.visit_mut_children_with(self);

        if !is_stampable_tag(&node.opening.name) {
            return;
        }

        let attr_names = editable_string_attrs(&node.opening.attrs);
        let bound_names = editable_bound_attrs(&node.opening.attrs);
        let bound_text = editable_bound_text_expr(
            &node.children,
            &self.map_params,
            &self.component_params,
        );
        let has_text = has_editable_text(&node.children);
        if !has_text && bound_text.is_none() && attr_names.is_empty() && bound_names.is_empty() {
            return;
        }
        if already_stamped(&node.opening.attrs) {
            return;
        }

        let loc = self.source_map.lookup_char_pos(node.opening.span.lo);
        let loc_value = format!("{}:{}:{}", self.filename, loc.line, loc.col.0 + 1);

        let capitalized = is_capitalized_tag(&node.opening.name);
        let needs_text_stamp = has_text || bound_text.is_some();

        // Capitalized components often swallow props (Reveal). For text/bound-text,
        // wrap children in a stamped <span> so the DOM always gets a host stamp;
        // data-loc still points at the component's source location for write-back.
        if capitalized && needs_text_stamp {
            let mut span_attrs = vec![data_attr("data-loc", loc_value.clone())];
            if let Some(path) = &bound_text {
                span_attrs.push(data_attr("data-nc-text-bound", path.clone()));
            }
            let kids = std::mem::take(&mut node.children);
            node.children = vec![wrap_children_in_span(kids, span_attrs)];

            // Attr stamps (if any) still go on the component — needs forwarding.
            if !attr_names.is_empty() || !bound_names.is_empty() {
                node.opening
                    .attrs
                    .push(data_attr("data-loc", loc_value));
                if !attr_names.is_empty() {
                    node.opening
                        .attrs
                        .push(data_attr("data-nc-attrs", attr_names.join(" ")));
                }
                if !bound_names.is_empty() {
                    node.opening
                        .attrs
                        .push(data_attr("data-nc-bound", bound_names.join(" ")));
                }
            }
            return;
        }

        // Host elements and member tags (motion.*): stamp in place.
        node.opening.attrs.push(data_attr("data-loc", loc_value));

        if !attr_names.is_empty() {
            node.opening
                .attrs
                .push(data_attr("data-nc-attrs", attr_names.join(" ")));
        }
        if let Some(path) = bound_text {
            node.opening
                .attrs
                .push(data_attr("data-nc-text-bound", path));
        }
        if !bound_names.is_empty() {
            node.opening
                .attrs
                .push(data_attr("data-nc-bound", bound_names.join(" ")));
        }
    }
}

#[plugin_transform]
fn process(mut program: Program, metadata: TransformPluginProgramMetadata) -> Program {
    let filename = metadata
        .get_context(&TransformPluginMetadataContextKind::Filename)
        .unwrap_or_default();

    program.visit_mut_with(&mut DataLocStamper {
        filename,
        source_map: metadata.source_map,
        map_params: Vec::new(),
        component_params: Vec::new(),
    });
    program
}
