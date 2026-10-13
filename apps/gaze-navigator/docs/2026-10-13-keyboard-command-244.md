# Keyboard fallback with website focus — #244

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
