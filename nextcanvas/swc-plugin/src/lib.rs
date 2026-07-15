//! nextcanvas SWC plugin — the SWC-native source-location stamp.
//!
//! Stamps `data-loc="<absFile>:<line>:<col>"` onto JSX elements the write-back
//! server can edit. Both host (lowercase) elements and plain-identifier
//! components (capitalized, e.g. `<Reveal as="h2">…</Reveal>`) are stamped: a
//! host element always renders the stamped DOM node, while a component exposes
//! the stamp only if it forwards unknown props to its root element
//! (`<Tag {...rest}>`) — a best-effort no-op otherwise. An element qualifies
//! when it has ANY of:
//!   - one or more non-whitespace `JSXText` direct children (editable text),
//!     whether plain (`<h1>Hello</h1>`) or mixed with inline child elements
//!     (`<p>Hello <strong>world</strong>!</p>`, where the surrounding text runs
//!     are editable and the inline elements are preserved), OR
//!   - a single **bound-text** child — see below, OR
//!   - at least one editable string-literal attribute (`<img src="/a.png"/>`,
//!     `<a href="/x">…</a>`; editable attribute value).
//!
//! **Bound text.** An element whose *only* non-whitespace child is a single
//! `{expression}` is normally left unstamped (its write-back target is
//! ambiguous), with two exceptions that ARE stamped as `data-nc-text-bound`:
//!   - a `{member.chain}` of plain identifiers (`{speaker.name}`, `{cfg.title}`)
//!     — stamped `data-nc-text-bound="speaker.name"`; the server resolves the
//!     base (a `.map` collection, or a direct object variable) and rewrites the
//!     leaf string property.
//!   - a bare `{identifier}` **that names the element parameter of an enclosing
//!     `.map`/`.flatMap` callback** (`truths.map((t) => <p>{t}</p>)`) — stamped
//!     `data-nc-text-bound="t"`; the server rewrites the mapped array's
//!     string-literal element whose value matches the edited text. The
//!     `.map`-param gate (a scope stack, `map_params`) is deliberate: a bare
//!     `{ident}` that is a component prop (`<pre>{children}</pre>`) or an
//!     arbitrary const is left unstamped — the server couldn't resolve it to one
//!     editable string and the affordance would only bounce.
//! Anything more complex — computed `{items[i].x}`, a call `{fn().y}`, or text
//! mixed with an expression (`Hi {name}`) — stays unstamped. (Expressions nested
//! *inside* a child element are fine — the child is preserved verbatim.)
//!
//! Editable attributes are emitted to the browser split by kind:
//!   - `data-nc-attrs` — string-literal attrs (`href="/x"`), edited in place.
//!   - `data-nc-bound` — bound simple-identifier attrs (`href={GITHUB}`), where
//!     the overlay asks whether to rewrite the shared variable (all references)
//!     or inline a literal for just this element.
//! Splitting by kind means the overlay never mistakes a bound `href={x}` (a
//! resolved URL in the DOM) for an editable literal.
//!
//! Because it runs inside SWC, it works under **both** the webpack (next-swc)
//! and Turbopack pipelines. Wired via `experimental.swcPlugins` (injected by
//! `withCanvas`), dev-only.

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
    /// `t`). A sole bare `{ident}` text child is only stamped when its identifier
    /// is on this stack — i.e. it's a mapped-array element the server can rewrite
    /// by value. This deliberately excludes component props (`<pre>{children}</pre>`,
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
            // whole element out of THIS path (bound text is handled separately).
            JSXElementChild::JSXExprContainer(_) | JSXElementChild::JSXSpreadChild(_) => {
                return false;
            }
            // Nested elements / fragments are preserved verbatim; skip them.
            _ => {}
        }
    }
    has_text
}

/// A member-access chain of plain identifiers, rendered as a dotted path.
/// `speaker.name` → `Some("speaker.name")`; `a.b.c` → `Some("a.b.c")`. Returns
/// `None` for anything else in the chain (computed `a[b]`, a call `fn()`, an
/// optional-chain link, a private field), so only expressions the write-back
/// server can resolve to one data-object property are stamped.
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

/// When the element's only non-whitespace child is a single `{expression}` the
/// server can rewrite, return the dotted path (or bare name) to stamp as
/// `data-nc-text-bound`. Two shapes qualify:
///   - a `{member.chain}` of plain identifiers (`{speaker.name}`) — always
///     editable; the server resolves the base and rewrites the leaf property.
///   - a bare `{identifier}` that names an active `.map`/`.flatMap` element
///     parameter (`map_params`) — a mapped-array element the server rewrites by
///     value. A bare identifier NOT on the map-param stack (a prop or const) is
///     rejected here so it stays unstamped.
/// Anything else — a nested element, more than one expression child, computed or
/// call access, or static text mixed with an expression — disqualifies it.
fn editable_bound_text_expr(children: &[JSXElementChild], map_params: &[String]) -> Option<String> {
    let mut found: Option<String> = None;
    for child in children {
        match child {
            JSXElementChild::JSXText(t) => {
                if !t.value.trim().is_empty() {
                    return None; // static text mixed with an expression
                }
            }
            JSXElementChild::JSXExprContainer(c) => {
                if found.is_some() {
                    return None; // more than one expression child
                }
                match &c.expr {
                    JSXExpr::Expr(e) => match &**e {
                        // `{member.chain}` — always editable (server resolves base).
                        Expr::Member(_) => found = Some(member_path(e)?),
                        // bare `{ident}` — only if it's a live `.map` element param.
                        Expr::Ident(id) => {
                            let name = id.sym.to_string();
                            if map_params.contains(&name) {
                                found = Some(name);
                            } else {
                                return None;
                            }
                        }
                        _ => return None,
                    },
                    _ => return None,
                }
            }
            // Nested elements / fragments / spreads make this not pure bound text.
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
    /// Track `.map`/`.flatMap` callback element params so a bare `{ident}` text
    /// child nested inside is recognized as a mapped-array element. Push before
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

        // Stamp host (lowercase, e.g. `div`) elements AND plain-identifier
        // components (capitalized, e.g. `Reveal`). A host element always renders
        // its own DOM node, so the stamp lands unconditionally. A component only
        // exposes the stamp in the DOM if it forwards unknown props to its root
        // element (`<Tag {...rest}>`, which polymorphic wrappers like `Reveal`
        // and `next/link`'s `<Link>` do) — when it does, `data-loc` reaches the
        // DOM and the component's text/attrs become editable; when it doesn't,
        // the extra prop is an inert no-op. Member/namespaced names (`Foo.Bar`,
        // `motion.div`, `ns:tag`) are still skipped — their prop forwarding is
        // less predictable and they aren't the reported case.
        match &node.opening.name {
            JSXElementName::Ident(_) => {}
            _ => return,
        }

        // Only stamp what the overlay can actually edit: an editable text run
        // (see has_editable_text) OR bound text (a single {member.chain} or a
        // `.map`-param {ident} child) OR ≥1 editable string-literal attribute OR
        // ≥1 editable bound-identifier attribute (href={VAR}).
        let attr_names = editable_string_attrs(&node.opening.attrs);
        let bound_names = editable_bound_attrs(&node.opening.attrs);
        let bound_text = editable_bound_text_expr(&node.children, &self.map_params);
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
        // old stamp (`loc.start.column + 1`).
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

        // Bound text (`<h3>{speaker.name}</h3>`, or `<p>{t}</p>` in a `.map`) —
        // the overlay edits the rendered value and the server rewrites the data
        // object's string property. The dotted path (or bare name) tells the
        // server what to resolve (`speaker.name` → `.name`; `t` → array element).
        if let Some(path) = bound_text {
            node.opening.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                span: DUMMY_SP,
                name: JSXAttrName::Ident(IdentName::new("data-nc-text-bound".into(), DUMMY_SP)),
                value: Some(JSXAttrValue::Str(Str {
                    span: DUMMY_SP,
                    value: path.into(),
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
