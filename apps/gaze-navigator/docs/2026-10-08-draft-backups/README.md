# Portable session drafts (#139)

Download saved drafts retains only committed subject/message records in explicit
local version1 `gaze-session-drafts` JSON. No camera, calibration, raw gaze,
inbox, tracking mode or unsaved composer fields enter the file. Import appends
validated records with fresh IDs; it never replaces the notebook or composer.
There is no autosave, sending, remote inference or browser-storage write.

The complete file must contain1–20 records, each a nonblank text subject up to200
UTF-16 code units and a message up to10000, matching existing editor limits.
The UTF-8 input/output cap is2MiB; twenty maximally JSON-escaped messages fit.
Unknown versions/fields, bad types, malformed JSON, invalid records and combined
notebook overflow refuse before mutation. Import preserves exact record text;
existing Save/Update still applies its established whitespace normalization.
Latest file selection owns publication; older success/errors cannot append over
it. Capacity is checked against current saved work after the asynchronous read.
Current typing, saved edits and pending composer replacement review are not
reset by import. Previews and labels render through textContent.

Gaze can download the notebook and reveal the import panel. A visible labeled
file input explains the ordinary mouse/keyboard activation required by browsers;
no transient activation from recent calibration is assumed and no security flag
is weakened. Export feedback says download requested, not guaranteed disk save.
Unsaved composer text is visibly excluded. Refresh still clears memory until the
user deliberately imports a separately saved backup.

## Verification

The missing module failed first. Initial full units found one old camera harness
missing new controls; its DOM inventory was corrected. The first temporary
browser config served the wrong working directory and timed out; it was stopped,
then corrected without changing product behavior. The next12 native cases had
8 passes and4 failures because the download oracle expected trailing whitespace
that existing Save deliberately trims. The fixture now describes the saved
canonical text. Review additionally caught synthetic gaze activation of a hidden
file input; the visible chooser design above addresses that browser restriction.
All these first logs remain unchanged beside final evidence.

Final69 unit tests, lint and build syntax checks pass. The full native Chromium
suite passes88 cases at1280x900,390x740,390x480 and390x651. Actual downloads are
read as independent JSON and exclude unsaved text; refresh/import/open/update
preserves complete original Unicode and script-shaped text without executing it.
The chooser path waits5.5seconds before gaze reveals it, then uses a trusted
ordinary click. Twenty maximum imported drafts retain their full contents;
malformed, oversized and over-capacity input preserves the composer/notebook.
A controlled delayed File.text boundary proves newer selection wins while
ordinary saved edits and unsaved fields remain. This boundary test is distinct
from the genuine file reads/downloads. Independent review found no further
important parser/atomicity issue. First full CI Chromium verification at source03b8e090bafa9d290bcd5c644b435bcbfe608910
passes69 units, lint/build and88 native cases
([run37718757731](https://github.com/twangyal/projects-monorepo/actions/runs/37718757731));
timestamped first log excerpts are retained in `first-ci-receipt.json`.
These software tests do not establish physical webcam accuracy
or arbitrary hands-free control of the operating-system chooser.
