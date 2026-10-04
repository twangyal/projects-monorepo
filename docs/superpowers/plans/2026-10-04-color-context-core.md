# Color Context Lab core implementation plan

Goal: implement the reviewed raw-pixel and context kernel as the first reusable unit of issue #70.
Spec: docs/superpowers/specs/2026-10-04-color-context-lab-design.md on Astra.
Architecture: independent browser-compatible TypeScript modules; Node 24 native tests. No runtime dependencies. The browser UI, storage, workers and preregistered experiment are later units, not represented as complete here.

1. Add exact types and strict model admission. Test detached snapshots, canonical base64, hidden RGB/alpha, source dimensions, unknown/accessor/prototype fields, Unicode and duplicate JSON keys/depth/byte limits before implementation.
2. Add bounded history. Test atomic invalid edits, no-op redo preservation, same-image identity, detached snapshots, count/byte trimming and reset.
3. Add comparison kernel. Independently calculate odd geometry, checker parity, center bytes, zero border, luminance/RMSE denominators and maximum raster output.
4. Add PNG inspection and exact export. Independently verify CRC/Adler, stored-DEFLATE using Node zlib, filters/scanline bytes, zero-alpha RGB, chunk framing, maximum output, unsupported chunk types and ancillary bounds.
5. Run all Node tests and independent Python/Pillow image decoding. Review module/API correspondence to the committed design, then create one coherent GitHub commit on Astra with completion evidence. Keep #70 open and accurately mark core-only progress.

Review focus: malformed Unicode; accessor side effects; noncanonical base64 pad bits; duplicate decoded JSON keys; zero-alpha pixels through PNG; maximum payload arithmetic. All are pinned by the core tests.
