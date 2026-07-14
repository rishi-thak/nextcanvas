//! nextcanvas SWC plugin — the SWC-native source-location stamp.
//!
//! Stamps `data-loc="<absFile>:<line>:<col>"` onto host (lowercase) JSX elements
//! that carry **at least one static text run the write-back server can edit** —
//! i.e. an element with one or more non-whitespace `JSXText` direct children.
//! This covers both plain static text (`<h1>Hello</h1>`) and text mixed with
//! inline child elements (`<p>Hello <strong>world</strong>!</p>`), where the
//! surrounding text runs are editable and the inline elements are preserved.
//!
//! An element with a **direct `{expression}` child** (a bound value) is left
//! unstamped: its text-node layout is ambiguous, so the overlay won't outline or
//! offer to edit something whose commit would just bounce. (Expressions nested
//! *inside* a child element are fine — the child is preserved verbatim.)
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

        // Only stamp what the overlay can actually edit (see has_editable_text).
        if !has_editable_text(&node.children) {
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
