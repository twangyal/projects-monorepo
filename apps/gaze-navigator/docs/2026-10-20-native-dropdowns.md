# Native dropdown selection — #293

The shared website runtime now preserves the intended native single-choice option across capture, clarification, focus and execution. Previously it trusted a numeric index, checked only an option's own disabled flag, overwrote selectedIndex and always reported success. That could write a locked control, clear other multi-select choices or select a replacement option after page changes.

## Behavior

Say **choose Hardcover from Format**, or use the existing choose/select/pick/set wording and deliberate ambiguity choice. The context records native option identities, parents, values, displayed labels, raw text and selection flags, plus select document/name/role, group metadata and the original iframe/document chain. Displayed `option.label` drives the offered names and selected-value description; raw text is retained separately for drift detection. These references remain inside the page context/execution. WaterSheep's explicit textual descriptions do not serialize these native references.

Before action, only a connected, unlocked, writable native single-choice SELECT and enabled option/optgroup are admitted. The complete snapshot must match. Multiple selection refuses before any focus/write/event, preserving all existing selections; additive/removal semantics are future work. An already selected admitted option succeeds without focus or events. Any stale identity, changed option label/value/order/selection, replacement, added option, lock or focus redirection refuses. Focus is rechecked through shadow and same-origin frame chains; original frames must remain connected with the same child documents.

A change uses the native selectedIndex setter, one composed bubbling input and one bubbling change. Site handlers own the resulting state; removal, locking or redirection during input stops further events. Feedback waits for the event handlers and their microtasks, then verifies the original option's identity/value/text/label/group and select name/role/document. It never retries, forces rollback or reports success for a site override. The deferred check uses the navigator module’s timer rather than a child window timer, so iframe retirement cannot strand feedback. New commands, pause and cancellation retire older feedback using the existing controller turn guard. This is a bounded next-task observation, not a wait for network or arbitrarily delayed website work.

The existing consequential-name policy now applies to the select or its requested displayed option. A consequential choice waits for confirmation/cancel and names the intended option and dropdown in the question. Confirmation still executes the original snapshot; later page drift refuses. This extends the existing lexical rule, not a claim of comprehensive risk detection or semantic interpretation.

Custom ARIA combobox/listbox widgets and multi-select authoring remain unsupported by this action. Ordinary activation, selection ambiguity and optional assisted target matching keep their existing contracts.

## Verification and limits

- First native RED: all eight original safety cases failed on the old implementation; a controller unit also proved the original snapshot was not forwarded through clarification.
- Review identified missing option.label capture and post-event select/group metadata. Separate native REDs reproduced displayed-label mismatch, control repurposing and optgroup drift before correction.
- Consequential choice/controller REDs established the missing confirmation route; a further unit RED required the confirmation question to actually name the requested choice.
- The first four-viewport pass exposed a test-fixture assumption: offered candidate2 was not always DOM id b, because controls are sorted by gaze distance. The corrected test mutates the actual offered candidate identity; production order is unchanged.
- All197 Node tests pass; syntax and extension-test build pass. Thirteen focused native cases cover events/no-op, control/optgroup locks, retained multiple selections, stale options, focus reentrancy, synchronous/microtask site overrides, ambiguity/cancel, stale feedback, shadow/frame propagation, displayed labels, optgroup repurposing and consequential confirmation. Their four-viewport gate passes52cases in18.0s.
- A separate iframe-retirement RED observed feedback still pending after250ms when a site removed the child frame in a microtask. Capturing live frame/document identities and scheduling from the navigator root makes the same regression resolve as an error. Independent review finds no remaining important issues.
- Local portable Chromium143 cannot load the extension worker: the unchanged strict-CSP extension setup times out waiting for serviceworker. This is not an extension pass. The broad local gate excludes exactly `extension.spec.js` (64cases); the ordinary hosted Chromium gate runs the full488cases across three shards. Executed broad/source/canonical outcomes are recorded in #293 and the completion addendum.

No physical webcam/speech, intended-user task-completion or broad framework/site acceptance is inferred. Gaze remains ACTIVE under the extension-first direction. No PR was requested or created; project #8 remains skipped.
