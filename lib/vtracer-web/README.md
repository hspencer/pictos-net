# vtracer-web

Browser binding for the VTracer 1.0 core, built for PICTOS (plan VE2 in
`docs/PLAN_VECTORIZAR_ESTRUCTURAR_2026-10-29.md`). Consumed through
`services/vtracerWebService.ts`.

## Pinned core

| Item | Value |
|---|---|
| Core | `vtracer` 1.0.0-alpha.4 (pre-release) |
| Commit | `2500df76b5aea0ac22d15296b22722442f825c5b` |
| License | MIT OR Apache-2.0 |
| Toolchain verified | rustc 1.98.1, wasm-pack 0.14.0, target `wasm32-unknown-unknown` |

`Cargo.lock` pins every dependency. `pkg/` is committed because the Netlify
build has no Rust toolchain. Rebuild with `scripts/build-vtracer-web.sh`, which
prints the SHA-256 of the WASM; record it in the commit message.

## What the binding exposes

`TraceSession(rgba, width, height, options)` segments once. Then:

- `regions()` lists regions in paint order: `regionId` (layer index in the
  cached segmentation), colour, bbox and pixel area.
- `region_mask(id)` returns the region's coverage inside its bbox (1 = inside).
- `finish(options)` traces every region and names the region of each path.
  It re-uses the segmentation, so changing curve options never re-segments.

Semantic safety: the pipeline uses the `Identity` colour fitter and disables
neighbour merging (`merge_diff = -1`), so no palette snap or merge can fuse two
regions. Mosaic shapes carry only a paint, so each layer is painted with its
own index for the run and the index is decoded from the output: provenance is
exact and needs no change to the core.

## Known limits

- Two touching regions of the same colour form one region; telling them apart
  needs a split (plan VE3 `splitRequests`, VE7).
- No progress or cancellation from JS; ~100 ms at 1024 px on the reference
  machine, so it runs on the main thread for now.
