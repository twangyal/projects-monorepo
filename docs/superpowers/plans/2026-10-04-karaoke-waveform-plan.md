# Karaoke waveform implementation plan

Follow the reviewed [design](../specs/2026-10-04-karaoke-waveform-design.md) for issue#54. User authorization is already in effect.

1. Review the contract and freeze engine/timing/controller interfaces. Resolve lifecycle and numerical objections before implementation.
2. Implement bounded streaming PCM/RIFF reduction and the original-source worker with targeted tests. Independently test extrema, bins, malformed inputs and maximum bounds.
3. Implement pure timing/view helpers and atomic proposals. Build timeline UI and main draft integration against those interfaces, preserving raw fields/history/export revisions.
4. Add real production browser waveform interaction, cancellation/race/mobile cases and independently decoded saved media. Keep fake separation explicitly separate from model evidence and delete test-owned clips.
5. Review source independently; run complete affected checks. On a copied existing real300-second project, measure source reduction, native browser responsiveness and exact late timing/export/restart behavior.
6. Update README/catalog/runtime evidence and package version. Commit/push durable milestones, update issue#54 and draft PR12, check remote CI and close only when accepted. Reassess remaining eligible work immediately.
