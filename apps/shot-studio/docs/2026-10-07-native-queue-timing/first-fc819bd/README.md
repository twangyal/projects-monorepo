# First native queue diagnostic headfc819bd

Standard [push37644733701](https://github.com/twangyal/projects-monorepo/actions/runs/37644733701) and [PR37644739723](https://github.com/twangyal/projects-monorepo/actions/runs/37644739723) pass361units/syntax, all113native cases and original configured maximum decode (1,800video /2,880,648audio frames). The PR checkout is d969d144fc1ac07c0c6b18091cdbdb1aa140bed6.

Full155 [push37644733525](https://github.com/twangyal/projects-monorepo/actions/runs/37644733525) and [PR37644739880](https://github.com/twangyal/projects-monorepo/actions/runs/37644739880) each fail the unchanged original maximum. Separate diagnostic push passes all original independent gates; diagnostic PR times out after1,450 submitted video samples, no finalize and18.5ms drained cancellation. Counts on failed export are not decoded-frame claims.

The passing diagnostic artifact is independently re-inspected locally using unchanged smoke_sequence_soundtrack.mjs: all1,800video frames,2,880,648audio frames and original40 visual/audio gates pass. Each of all four exact11,554,385B complete archives survives restart byte-for-byte. ZIP digests match GitHub, and every entry is independently hashed in artifact-provenance.json. Raw first receipts/browser logs are retained; binary originals are identified by hashes instead of duplicated.

## Timing interpretation withdrawn

Push diagnostic records69.080s summed video dequeue observation against67.120s aggregate addVideo. PR records69.489s against67.861s. These first timing values **must not be used as isolated native wait attribution**. A real-UA regression demonstrates the earlier exporter listener's Promise continuation runs before the later observer listener. The observer includes subsequent exporter work before its own delivery. See ../listener-order/README.md for the red/green repair. Counts, media output and original independent acceptance remain valid separately; neither a diagnostic pass nor corrected instrumentation clears the original full155 failures.
