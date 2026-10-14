# Gaze canonical integration review — #246

## Accepted canonical integration

The six blockers recorded below are resolved in candidate `5035c643272ce04c019fbb2fff432677c03a2a66`. Independent reconciliation review found no further blocker. Hosted [run 38379272574](https://github.com/twangyal/projects-monorepo/actions/runs/38379272574) passed **139 unit tests and 208 native Chromium cases**, with syntax/build gates also passing. Canonical integration retains that exact application/runtime/test tree and adds documentation updates only. #246 is complete as far as available tooling permits; physical evaluation #132 and typed-fallback menu preservation #244 remain separate open work. The failed regressions and partial patch below are historical checkpoints, superseded by the reconciled candidate.


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

## Reconciled candidate — 5035c643

The isolated candidate `autonomous/gaze-integration-246` imports only Gaze from frozen `d6f594ac95d7e5cac7a2c355b0e778bf41c26083` onto canonical `62c9c88`. The seven guard files were reconciled rather than replacing canonical safeguards. Its controller confirmation and speech-session tests retain the original protections. Overlay Stop/pagehide now cancel the controller and recognition session, clear captured/prompt context, and invalidate camera startup. BFCache restoration exposes stopped listening with an explicit restart. Disabling smarter matching invalidates any pending model answer through the existing controller cancellation turn. Three browser tests cover delayed model completion after Stop, pagehide, and disabling matching.

Fresh local verification: 139 unit tests passed; syntax checks for 83 files passed; the extension test build passed. An independent read-only reviewer found all six earlier blockers closed and reran 18 canonical controller/speech cases successfully. Local Chromium failed at launch with SIGSEGV, before application tests ran; this is an environment limitation, not passing browser evidence. Hosted native [CI run 38379272574](https://github.com/twangyal/projects-monorepo/actions/runs/38379272574), job 115235335776, completed successfully: 139 unit tests and all 208 native Chromium cases passed, along with syntax/build gates. The downloaded completed-job logs establish those counts. Real model inference and physical gaze/speech evaluation were not repeated during integration; imported measurement reports retain their original developer-authored tasks and simulated-input limitations.

This candidate supersedes the earlier four-file partial patch as the integration vehicle. The earlier audit and failed-regression evidence above remain historical evidence.

The candidate rule CLI also reran all three frozen instruction suites: 120/120 tuned, 34/50 held-out and 18/50 held-out-2, with zero unsafe actions in all three. These are rule-only measurements and do not constitute new WaterSheep inference evidence.
