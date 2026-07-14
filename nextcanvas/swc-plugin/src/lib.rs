//! nextcanvas SWC plugin — the SWC-native replacement for the old Babel plugin.
//!
//! Stamps `data-loc="<absFile>:<line>:<col>"` onto host (lowercase) JSX elements
//! **whose sole child is a static text node** — i.e. exactly the elements the
//! write-back server can edit. Elements whose child is a `{expression}` (bound
//! value), or that have mixed/multiple children, are intentionally left
//! unstamped so the browser overlay won't outline or offer to edit something
//! whose commit would just bounce (the server can only rewrite a JSXText node).
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

        // Only stamp what the overlay can actually edit (see is_single_static_text).
        if !is_single_static_text(&node.children) {
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
