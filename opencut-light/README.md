# CapCut 2 Light — OpenCut Classic (experimental Windows-first)

Source project: [OpenCut Classic](https://github.com/OpenCut-app/OpenCut-classic).
This is a separate development branch of `raphaelsancho21-byte/capcutlite`. It does not replace the Android/Windows apps on `main`.

**Licensing:** OpenCut Classic is licensed under MIT; its original `LICENSE` file is preserved unchanged in `opencut-classic/LICENSE` after import. Attribution: Copyright 2025–2026 OpenCut. Modifications are separately documented here.

## Current modifications (first pass; performance unverified)
- `apps/web/src/media/thumbnail.ts`: previews capped at 640×360 instead of 1280×720; JPEG quality 0.7 instead of 0.8. This reduces thumbnail pixel allocation to 25% of the old maximum. **Not** export resolution.
- `apps/web/src/media/waveform-summary.ts`: fill a `Float32Array` directly instead of constructing a per-bucket object array plus another numbers array. Audio source and timeline timestamps are unchanged.

The overrides live in `opencut-light/overrides`. The workflow `.github/workflows/import-opencut-classic.yml` imports a pinned snapshot of upstream `main` into `opencut-classic/` and overlays these two changes. It records the exact upstream commit. Re-run via GitHub Actions to regenerate.

## Priorities
1. Confirm upstream baseline and source-derived patches typecheck/build.
2. Benchmark memory and responsiveness with representative 1080p/H.264 and audio files on Windows.
3. Profile playback/render loop, avoid decoding work on idle.
4. Maintain timeline collision, clipping, audio sync and export accuracy.
5. Package Windows editor only after the base is functional; native EXE is **not** yet provided by this branch.

**Important:** OpenCut Classic is an archived TypeScript/Next.js editor. Its desktop app was in progress; these first optimizations do not magically turn it into a polished native Windows EXE.
