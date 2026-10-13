# Keyboard fallback with website focus — #244

## Accepted integration

Repaired source `2f8b29297971c4e2035f026ef6a6b1bf060bdbaf` passes **148 unit tests and all 240 native Chromium cases** in [hosted run 38420433389](https://github.com/twangyal/projects-monorepo/actions/runs/38420433389), job 115376005915. Completed job logs establish those counts; syntax and extension-build gates also pass. Independent review found no blocker. Canonical integration retains this runtime/test tree and adds documentation updates.

The initial candidate c70ffac failed native acceptance: 17 failures/223 passes in run38382150717 despite147 unit passes. Real Control keydown cancelled before Ctrl+A/V; dynamic frame load events were watched at Window rather than Document; visible helper text enlarged the default panel and affected one narrow existing flow. The repair keeps pure modifiers active, attaches/removes document-level frame load handlers, and moves helper text into collapsed help. A realistic modifier regression failed before repair and passes afterward. With a correctly configured portable Chromium, all32 new browser cases and4 existing frame-discovery cases pass locally across four viewports. Earlier browser download/extraction/context setup failures remain environment evidence and are not application passes. No production settings or CI gates were weakened.

Physical/assistive-technology and fresh live-site evaluation remain outstanding. These gates accept this keyboard fallback milestone, not the full accessibility product.


## Outcome and root cause

People using the typed fallback should be able to choose website search suggestions and menus that disappear on blur. The ordinary instruction input moved focus into the navigator; a saved snapshot alone could not safely activate options removed by the website. The execution helper also focused a control before clicking it, which could itself remove a suggestion before its delegated click handler ran.

## Implementation

Alt+Shift+G explicitly starts a command buffer while website focus stays put. The panel mirrors the text and announces command/selection changes while the mode is active. Enter submits against the context captured at the shortcut; Escape/toggling cancels. Character entry, selection, arrow/Home/End editing, Backspace/Delete and clipboard paste are supported. The ordinary instruction-box draft returns afterward. Other browser shortcuts and Tab leave the mode. Shortcut detection includes the physical KeyG so Alt-produced characters do not break it.

A focused native field is temporarily protected from unintended default text entry. Website-owned readonly mutations cancel the mode and retain the website's new state. Changing focus, losing window visibility/focus, child-frame navigation, pagehide and Stop end capture and restore normal typing. Same-origin frame documents receive the same handlers. Editable page regions require the ordinary instruction input or speech, and composed/IME text requires paste. These are current interaction constraints, not a permanent product boundary.

Only keyboard-command activation of a non-editable control preserves focus; ordinary and spoken execution keep their existing behavior. Clarification, consequential-action confirmation, disconnected-target checks and delayed-model cancellation remain controller-owned. Website input values are not replaced on cancellation. No model downloads or network services are introduced.

## Evidence

Baseline: 139 unit tests. Red-first tests showed missing explicit capture, selection replacement, lifecycle cleanup, physical-shortcut recognition and blur-before-click activation. The connected-target reproduction failed before preserve-focus activation and passes afterward. Fresh final local unit/syntax/extension-build checks are recorded in the GitHub issue; native hosted acceptance is pending. Local Chromium has previously failed at startup with SIGSEGV, so no local browser success is claimed.

The practice fixture removes suggestions immediately on blur and uses a delegated menu handler, so clicking a detached node cannot produce a false success. Native tests cover selection, Escape and resumed ordinary typing, pagehide/Stop, real clipboard paste, ordinary draft preservation, same-origin frame selection/navigation, website-owned readonly changes and live editing feedback across four viewports. Physical keyboard/assistive-technology evaluation and a fresh live Wikipedia run are not included; broader task/user acceptance remains open.

Previous integration verification is complete: canonical Gaze run 38380496617 and Karaoke run 38380496633 at 8839812 both passed their project gates.
