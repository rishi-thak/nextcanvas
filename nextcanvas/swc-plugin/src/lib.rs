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
//! An element with a **direct `{expression}` child** (a bound value) is left
//! unstamped for text purposes: its text-node layout is ambiguous, so the
//! overlay won't offer to edit something whose commit would just bounce.
//! (Expressions nested *inside* a child element are fine — the child is
//! preserved verbatim.) Such an element is still stamped if it has an editable
//! attribute. Editable attributes are emitted to the browser split by kind:
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
    Expr, IdentName, JSXAttr, JSXAttrName, JSXAttrOrSpread, JSXAttrValue, JSXElement,
    JSXElementChild, JSXElementName, JSXExpr, Program, Str,
};
use swc_core::ecma::visit::{VisitMut, VisitMutWith};
use swc_core::plugin::metadata::TransformPluginMetadataContextKind;
use swc_core::plugin::plugin_transform;
use swc_core::plugin::proxies::{PluginSourceMapProxy, TransformPluginProgramMetadata};

struct DataLocStamper {
    filename: String,
    source_map: PluginSourceMapProxy,
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
        // (see has_editable_text) OR ≥1 editable string-literal attribute OR
        // ≥1 editable bound-identifier attribute (href={VAR}).
        let attr_names = editable_string_attrs(&node.opening.attrs);
        let bound_names = editable_bound_attrs(&node.opening.attrs);
        if !has_editable_text(&node.children) && attr_names.is_empty() && bound_names.is_empty() {
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
    });
    program
}
