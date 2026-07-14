//! nextcanvas SWC plugin — the SWC-native replacement for the old Babel plugin.
//!
//! Stamps `data-loc="<absFile>:<line>:<col>"` onto host (lowercase) JSX elements
//! the write-back server can edit — i.e. an element that has EITHER:
//!   - a sole static-text child (`<h1>Hello</h1>`; editable text), OR
//!   - at least one editable string-literal attribute (`<img src="/a.png"/>`,
//!     `<a href="/x">…</a>`; editable attribute value).
//! Elements whose text child is a `{expression}` (bound value) or that have
//! mixed/multiple children — and whose attributes are all `{expr}` — are
//! intentionally left unstamped, so the browser overlay won't offer to edit
//! something whose commit would just bounce (the server can only rewrite a
//! JSXText node or a string-literal JSXAttr).
//!
//! Because it runs inside SWC, it works under **both** the webpack (next-swc)
//! and Turbopack pipelines — unlike a Babel plugin, which opts Next out of SWC.
//! Wired via `experimental.swcPlugins` (injected by `withCanvas`), dev-only.

use swc_core::common::{SourceMapper, DUMMY_SP};
use swc_core::ecma::ast::{
    IdentName, JSXAttr, JSXAttrName, JSXAttrOrSpread, JSXAttrValue, JSXElement,
    JSXElementChild, JSXElementName, Program, Str,
};
use swc_core::ecma::visit::{VisitMut, VisitMutWith};
use swc_core::plugin::metadata::TransformPluginMetadataContextKind;
use swc_core::plugin::plugin_transform;
use swc_core::plugin::proxies::{PluginSourceMapProxy, TransformPluginProgramMetadata};

struct DataLocStamper {
    filename: String,
    source_map: PluginSourceMapProxy,
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

/// True only when the element's sole child is a non-whitespace static JSXText —
/// text the write-back server can actually rewrite. `{expression}` children
/// (bound values / string literals) and mixed/multiple children return false.
fn is_single_static_text(children: &[JSXElementChild]) -> bool {
    if children.len() != 1 {
        return false;
    }
    match &children[0] {
        JSXElementChild::JSXText(t) => !t.value.trim().is_empty(),
        _ => false,
    }
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

        // Only stamp what the overlay can actually edit: a single static-text
        // child (editable text) OR ≥1 editable string-literal attribute.
        let attr_names = editable_string_attrs(&node.opening.attrs);
        if !is_single_static_text(&node.children) && attr_names.is_empty() {
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
