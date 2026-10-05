# Clothing pending import ownership (#118)

Root accepted this bounded design after the unchanged normal production build
reproduced all three data-loss scenarios on 2026-10-05. A genuine `File.text`
result was held while the user committed a title, left a raw numeric draft, or
started a trusted sketch gesture. Delivering the old backup replaced each new
state and saved the older complete graph. The baseline receipt retains all
original fixture bytes, downloaded backups, native records and traces.

## Required behavior

An explicit backup or photo import may replace work only while it still owns
the current editor intent. Its generation is retired by newer raw input,
change-only form actions, editing commands, admitted sketch/placement starts,
undo/redo, another import, explicit cancellation or pagehide. Changed-back
input still represents newer intent. Invalid raw numeric input must survive
late asynchronous completion too.

Retirement changes only the import generation, busy indicator and dependent
replacement-button state. It must not normalize controls, repaint, commit,
increment edit history, cancel the newly active gesture or discard raw values.
In particular the existing `updateControls()` placement loop must not run from
captured raw-input retirement. A stale success, rejection or finalizer cannot
adopt content, alter status or release a newer import's busy state.

Successful current imports consume their own operation before adopting their
validated complete graph or photo through the ordinary edit/history/save path.
They still make one reversible edit. Native image resources retain the existing
decoder cleanup. The change does not alter formats, image limits, storage
transaction recovery, cross-tab policy, rendering or history capacity.

Preserve startup restoration's existing intent protection. A controlled
persisted page transition verifies lifetime policy only; it is not evidence of
actual back/forward-cache eligibility or physical navigation behavior.

## Verification

An independent eight-case native oracle freezes original complete JPEG,
garment, placement and stroke data before implementation. It checks actual
backup downloads, preserved photo bytes, exported PNG color samples, native
text selection, raw numeric node/focus/value, whole-graph Undo/Redo, trusted
sketch/placement gestures, held actual native bitmap delivery and resource
cleanup, old-error/new-operation isolation, cancellation and fresh retry.

Run the existing 39 units and 31 native cases with the new coverage, lint,
type checking and production build. Preserve first failures and distinguish
fixture corrections from product repairs. Publish implementation and verify
the actual push/PR checkouts before closing #118. No merge or deployment.
