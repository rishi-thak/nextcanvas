// swc_plugin_proxy declares the host functions (__get_transform_context,
// __lookup_char_pos_source_map_proxy, …) as plain `extern "C"` blocks with no
// `#[link(wasm_import_module = …)]`. On current Rust/wasm-ld these are treated
// as hard-undefined rather than Wasm imports, so the link fails. `--allow-undefined`
// tells wasm-ld to emit them as imports (the SWC host provides them at runtime).
//
// Applied via rustc-link-arg (not RUSTFLAGS) so it only affects this cdylib and
// does not invalidate the compiled dependency graph.
fn main() {
    println!("cargo:rustc-link-arg=--allow-undefined");
}
