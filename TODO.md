# TODO

## SWC plugin build

- [ ] **Re-enable size optimization on the wasm build.** LTO is currently **off**
  in `nextcanvas/swc-plugin/Cargo.toml` because cross-crate LTO dropped the Wasm
  import attributes on `swc_plugin_proxy`'s host externs, breaking the link. The
  artifact is ~1.4 MB; revisit smaller-binary options (e.g. `wasm-opt`, targeted
  LTO, `opt-level="z"`) once the link issue can be avoided.
- [ ] **Revisit the `swc_core` version pin.** Pinned to `58.0.4` to match Next
  16.2.0's era rather than the newest `swc_core`, because Wasm-plugin backward
  compatibility only protects *older-plugin → newer-runtime*, never the reverse.
  Re-evaluate when bumping the supported Next version, or if shipping multiple
  Next targets (would need a version matrix / multiple `.wasm` builds).

## Known limitations

- [ ] **Turbopack on Windows** does not execute the Wasm SWC plugin yet (upstream
  vercel/next.js#84972, #78156). Webpack works everywhere; Turbopack works on
  macOS/Linux. Revisit when the upstream gap closes.
