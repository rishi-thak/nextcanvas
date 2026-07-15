//! nextcanvas SWC plugin — the SWC-native source-location stamp.
//!
//! Stamps `data-loc="<absFile>:<line>:<col>"` onto host (lowercase) JSX elements
//! the write-back server can edit — i.e. an element that has EITHER:
//!   - one or more non-whitespace `JSXText` direct children (editable text),
//!     whether plain (`<h1>Hello</h1>`) or mixed with inline child elements
//!     (`<p>Hello <strong>world</strong>!</p>`, where the surrounding text runs
//!     are editable and the inline elements are preserved), OR
//!   - at least one editable string-literal attribute (`<img src="/a.png"/>`,
//!     `<a href="/x">…</a>`; editable attribute value).
//!
//! An element with a **direct `{expression}` child** mixed with static text is
//! left unstamped for text purposes: its text-node layout is ambiguous, so the
//! overlay won't offer to edit something whose commit would just bounce.
//! (Expressions nested *inside* a child element are fine — the child is
//! preserved verbatim.) The one bound-text shape that IS editable is an element
//! whose *sole* child is a single bare `{identifier}` **that names the element
//! parameter of an enclosing `.map`/`.flatMap` callback**
//! (`truths.map((t, i) => <p>{t}</p>)`): it's stamped `data-nc-text-bound="<name>"`,
//! and the write-back server rewrites the mapped array's string-literal element
//! whose value matches the edited text. The `.map`-param gate is deliberate: a
//! bare `{ident}` that is a component prop (`<pre>{children}</pre>`,
//! `<span>{file}</span>`) or an arbitrary const is left unstamped, because the
//! server couldn't resolve it to one editable string and the affordance would
//! only bounce. Such an element is also stamped if it has an editable attribute.
//! Editable attributes are emitted to the browser split by kind:
//!   - `data-nc-attrs` — string-literal attrs (`href="/x"`), edited in place.
//!   - `data-nc-bound` — bound simple-identifier attrs (`href={GITHUB}`), where
//!     the overlay asks whether to rewrite the shared variable (all references)
//!     or inline a literal for just this element.
//! Splitting by kind means the overlay never mistakes a bound `href={x}` (a
//! resolved URL in the DOM) for an editable literal.
//!
//! Because it runs inside SWC, it works under **both** the webpack (next-swc)
//! and Turbopack pipelines — unlike a Babel plugin, which opts Next out of SWC.
//! Wired via `experimental.swcPlugins` (injected by `withCanvas`), dev-only.

use swc_core::common::{SourceMapper, DUMMY_SP};
use swc_core::ecma::ast::{
    CallExpr, Callee, Expr, IdentName, JSXAttr, JSXAttrName, JSXAttrOrSpread, JSXAttrValue,
    JSXElement, JSXElementChild, JSXElementName, JSXExpr, MemberProp, Param, Pat, Program, Str,
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
    /// `t`). A sole `{ident}` text child is only stamped when its identifier is
    /// on this stack — i.e. it's a mapped-array element the server can rewrite by
    /// value. This deliberately excludes component props (`<pre>{children}</pre>`,
    /// `<span>{file}</span>`) and arbitrary consts, which would only bounce.
    map_params: Vec<String>,
}

/// The first parameter of a `.map`/`.flatMap` callback, when it's a plain
/// identifier binding (`(t, i) => …`). Destructuring params (`({id}) => …`) and
/// index-only positions return None — only the element binding is editable.
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
            // A direct bound value makes text-run mapping ambiguous — leave the
            // whole element unstamped (unchanged behavior for `<h1>{title}</h1>`).
            JSXElementChild::JSXExprContainer(_) | JSXElementChild::JSXSpreadChild(_) => {
                return false;
            }
            // Nested elements / fragments are preserved verbatim; skip them.
            _ => {}
        }
    }
    has_text
}

/// When the element's only meaningful child is a single bare `{identifier}`
/// bound expression (`<h1>{title}</h1>`, or `<p>{t}</p>` inside a `.map`),
/// returns the identifier name. Pure-whitespace `JSXText` is ignored; anything
/// else disqualifies it: non-whitespace static text (that's `has_editable_text`
/// territory), an element/fragment/spread child, more than one expression, or a
/// non-identifier expression (`{a.b}`, `{fn()}`, `{c ? a : b}`) the server
/// couldn't resolve to one string declaration. Mutually exclusive with
/// `has_editable_text` (that path requires text; this one forbids it).
fn bound_text_ident(children: &[JSXElementChild]) -> Option<String> {
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
                    return None; // more than one expression child
                }
                match &c.expr {
                    JSXExpr::Expr(e) => match &**e {
                        Expr::Ident(id) => found = Some(id.sym.to_string()),
                        _ => return None,
                    },
                    JSXExpr::JSXEmptyExpr(_) => return None,
                }
            }
            // Any element / fragment / spread child disqualifies.
            _ => return None,
        }
    }
    found
}

/// Attributes the write-back server can rewrite (each must be a plain string
/// literal in source, e.g. `src="/a.png"`). Kept in sync with EDITABLE_ATTRS in
/// `src/overlay.ts`. `aria-label` is a single hyphenated JSX identifier.
const EDITABLE_ATTRS: [&str; 6] = ["src", "href", "alt", "title", "placeholder", "aria-label"];

/// The whitelisted attributes on this element whose value is a **string literal**
/// (`src="…"`) — NOT a `{expression}`, which the server can't rewrite. This is
/// what makes `<img>`/`<a>` (no static-text child) editable, and — crucially —
/// it's emitted to the browser as `data-nc-attrs` so the overlay edits only
/// these and never mistakes a bound `href={x}` (a resolved URL in the DOM, which
/// looks identical to a literal) for an editable one.
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

/// The whitelisted attributes on this element whose value is a **bound simple
/// identifier** (`href={GITHUB}`) — i.e. a `{expression}` that is a bare
/// variable reference, not a literal, member access, or call. These are emitted
/// as `data-nc-bound` so the overlay can offer to edit them, prompting the user
/// to change either the shared source variable (all references) or just this one
/// (inline a literal here). Anything more complex than a plain identifier
/// (`href={cfg.url}`, `href={fn()}`) is left out — the server can't resolve it to
/// a single string declaration safely.
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

impl VisitMut for DataLocStamper {
    /// Track `.map`/`.flatMap` callback element params so a `{ident}` text child
    /// nested inside is recognized as a mapped-array element. Push before
    /// descending (so inner JSX sees the binding) and pop after.
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

    fn visit_mut_jsx_element(&mut self, node: &mut JSXElement) {
        node.visit_mut_children_with(self);

        // Only host (lowercase) elements render a DOM node; components (Foo)
        // and member/namespaced names (Foo.Bar, ns:tag) are skipped.
        let sym = match &node.opening.name {
            JSXElementName::Ident(id) => id.sym.clone(),
            _ => return,
        };
        match sym.chars().next() {
            Some(c) if c.is_ascii_lowercase() => {}
            _ => return,
        }

        // Only stamp what the overlay can actually edit: an editable text run
        // (see has_editable_text) OR a sole bound `{identifier}` child
        // (bound_text_ident) OR ≥1 editable string-literal attribute OR
        // ≥1 editable bound-identifier attribute (href={VAR}).
        let attr_names = editable_string_attrs(&node.opening.attrs);
        let bound_names = editable_bound_attrs(&node.opening.attrs);
        // Only a sole `{ident}` child that names an active `.map` element param
        // qualifies — this is what the server can rewrite by value in the mapped
        // array. Props (`{children}`, `{file}`) and consts are left unstamped.
        let bound_text =
            bound_text_ident(&node.children).filter(|name| self.map_params.contains(name));
        if !has_editable_text(&node.children)
            && bound_text.is_none()
            && attr_names.is_empty()
            && bound_names.is_empty()
        {
            return;
        }
        if already_stamped(&node.opening.attrs) {
            return;
        }

        // Byte-offset span -> (line, column). Column made 1-based to match the
        // old Babel stamp (`loc.start.column + 1`).
        let loc = self.source_map.lookup_char_pos(node.opening.span.lo);
        let value = format!("{}:{}:{}", self.filename, loc.line, loc.col.0 + 1);

        node.opening.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
            span: DUMMY_SP,
            name: JSXAttrName::Ident(IdentName::new("data-loc".into(), DUMMY_SP)),
            value: Some(JSXAttrValue::Str(Str {
                span: DUMMY_SP,
                value: value.into(),
                raw: None,
            })),
        }));

        // Tell the overlay exactly which attributes are safe to edit (string
        // literals in source). Without this it can't tell a literal `href="/x"`
        // from a bound `href={x}` — both are just a resolved value in the DOM.
        if !attr_names.is_empty() {
            node.opening.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                span: DUMMY_SP,
                name: JSXAttrName::Ident(IdentName::new("data-nc-attrs".into(), DUMMY_SP)),
                value: Some(JSXAttrValue::Str(Str {
                    span: DUMMY_SP,
                    value: attr_names.join(" ").into(),
                    raw: None,
                })),
            }));
        }

        // Sole bound `{identifier}` text child (`<p>{t}</p>`) — carry the
        // identifier name so the server can resolve it (shared const vs `.map`
        // callback param) without re-parsing the expression.
        if let Some(name) = bound_text {
            node.opening.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                span: DUMMY_SP,
                name: JSXAttrName::Ident(IdentName::new("data-nc-text-bound".into(), DUMMY_SP)),
                value: Some(JSXAttrValue::Str(Str {
                    span: DUMMY_SP,
                    value: name.into(),
                    raw: None,
                })),
            }));
        }

        // Bound-identifier attributes (`href={VAR}`) — the overlay offers these
        // too, but on commit asks whether to rewrite the shared variable or
        // inline a literal for just this element.
        if !bound_names.is_empty() {
            node.opening.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                span: DUMMY_SP,
                name: JSXAttrName::Ident(IdentName::new("data-nc-bound".into(), DUMMY_SP)),
                value: Some(JSXAttrValue::Str(Str {
                    span: DUMMY_SP,
                    value: bound_names.join(" ").into(),
                    raw: None,
                })),
            }));
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
    });
    program
}
