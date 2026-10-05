# Karaoke cue split and merge — issue #121

Keep existing project schema and service APIs. Add pure proposal functions that
validate the entire current cue list, produce detached literal text/time edits,
then validate the complete result against existing limits. Split uses a collapsed
UTF-16 caret at a Unicode code-point boundary and an interior native playhead.
Merge joins adjacent literal words with one newline and includes their gap.

Add per-line accessible buttons and concise usage/gap guidance. Capture and remap
raw numeric spellings before rebuilding rows; preserve title/pasted drafts and
unaffected fields. Successful actions retire stale asynchronous lyric reviews,
record one unsaved history state and move focus to the resulting text. Rejected
proposals keep the editor and history unchanged.

Verify domain RED/GREEN boundaries and original production browser cases with
native audio seeks, literal Unicode, Undo/Redo, invalid raw fields, exact service
save/reopen and actual SRT downloads. Run existing TypeScript/Python/browser gates,
review, commit on latest Astra, and record exact published-head CI.
