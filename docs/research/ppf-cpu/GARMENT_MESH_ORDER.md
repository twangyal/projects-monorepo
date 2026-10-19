# Pinned mesh-order diagnostic — #290

This tests a specific initialization-order hypothesis separately from the unchanged-backend native repeatability runs. Pinned `crates/ppf-cts-solver/src/mesh.rs` emits edge/hinge arrays from `std::HashMap` iteration. The CPU scheduler and reductions explicitly aim to preserve order across worker counts; do not attribute trajectory differences to ordinary parallel accumulation without evidence.

The diagnostic appends a `#[cfg(test)]` module to that exact pinned file and executes the actual private mesh routines through Cargo. Production algorithms remain unchanged. Two assertions require canonical edge/hinge ordering while preserving original oriented tuples, the rod prefix, correlated face-neighbor rows and repeated construction; a third checks existing non-manifold first-two-face/excluded-hinge behavior. The job succeeds only when the two intended ordering assertions fail and the semantic control passes. Compilation or infrastructure failures are not accepted as the intended RED result. Complete logs, original revision, source/test digests and the test-only diff are retained. Actual execution is pending.

A failing ordering assertion establishes a local ordering-contract gap, not proof that it causes the observed native trajectories. A later sorting experiment must retain original tuples, generate paired arrays from the same canonical sequence, rebuild dependent structures and preserve unpatched experiments. No backend adoption, material calibration or physical-fit claim follows.

Dedicated branch: `autonomous/clothing-ppf-mesh-order-290`. Local Rust execution is unavailable; CI compiles and runs the exact test. The native repeatability matrix remains fixed at its separate source commit.
