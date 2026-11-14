# CapCut 2 Light — Windows (experimental)

This experimental launcher packages the **actual OpenCut Classic Next.js editor** in an Electron Windows executable. The OpenCut video engine remains web-based (TypeScript + WASM), not a native Rust renderer. The EXE hosts a private Next.js server on 127.0.0.1 and opens the editor in a sandboxed window.

## Build

Run **Build CapCut 2 Light Windows** on branch `capcut2-opencut-light`. The CI workflow uses Bun to compile the imported MIT-licensed OpenCut Classic into a standalone Next.js server, then wraps it in an Electron portable EXE. The workflow must pass before an EXE will appear in Artifacts.

## Caveats

- Experimental, **not tested yet**. OpenCut's application may require backend services or environment configuration; packaging doesn't remove those dependencies.
- Even though packaged as EXE, the renderer remains browser-based. Performance improvements need profiling, not merely wrapping.
- Source: https://github.com/OpenCut-app/OpenCut-classic (MIT, copyright 2025–2026 OpenCut).
- Changes: reduced maximum thumbnail 1280×720 → 640×360 and direct waveform `Float32Array`.
- No update installation or mobile APK is included in this experimental fork.
