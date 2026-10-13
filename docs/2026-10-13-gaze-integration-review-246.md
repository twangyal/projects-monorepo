# Gaze canonical integration review — #246

Frozen completed source d6f594a is reviewed against canonical857ad23. This is a review receipt, not model admission or integration. Owner direction favors WaterSheep and useful real-site task completion; ongoing typed-fallback#244 remains separate.

Independent read-only review finds six blockers before the completed branch can be integrated:

1. Ordinary-field search writes/submits without the canonical confirmation step.
2. Confirmed actions can execute after their control is disconnected.
3. Queued callbacks from stopped/previous recognition sessions still deliver commands.
4. Pagehide/Stop lose speech/controller cancellation and BFCache reset.
5. Delayed model choices can execute after Stop or assistant disable because action execution precedes the UI stopped check.
6. Canceled camera startup can overtake an immediate retry because source-generation checks were removed.

Canonical controller/speech tests were streamed against the reviewed source without editing it. Three regressions fail: non-search fallback expected pending confirmation but got none; removed Delete account control was activated; queued speech after Stop was delivered. The first harness invocation used incompatible Node flags and was corrected; that setup error is not application evidence. No physical camera/microphone or new real-model inference is claimed.

Several protections and their tests were introduced by#216 and are absent from the newer branch. Preserve them when reconciling changes from the shared18afa17 baseline; a wholesale source restore is not an accepted integration. New model turns additionally need explicit invalidation on Stop,pagehide and assistant disable, with deferred-answer regressions. Camera lifecycle ownership and native suspension/restoration tests must also be retained. Run complete updated source gates before merging.

#246 remains open. Gaze implementation on canonical main is unchanged by this review. All apps remain ACTIVE and project8 stays skipped. No PR, charges, production deployment or weakened security is introduced.


A nonconflicting partial reconciliation against the frozen d6f594a snapshot is retained in [the guard patch](2026-10-13-gaze-canonical-guards-246.patch). It restores controller consent/target checks, recognition session ownership and related canonical regression coverage. Six speech tests pass on the reconciled checkout. This is a patch artifact, not a main runtime change or accepted full integration. Textual conflicts remain in overlay coordination, controller tests and native navigation tests; delayed-model turn invalidation still requires implementation and verification. Reconcile against the current completed branch snapshot carefully; do not assume a moving branch ref remains at d6f594a.
