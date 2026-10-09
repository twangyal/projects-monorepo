# Retained stroke reuse verification

Issue #158 adds detached stroke copies immediately above the selected stroke and local-bound horizontal/vertical mirrors. Copies select their independent path; mirrors preserve point order and all layer poses. Actions affect only the selected held drawing, admit through the existing complete-project validator, and use existing one-edit history/autosave/rendering. Unchanged axis geometry adds no history; quota errors do not partially edit artwork.

Local verification: all 243 unit tests, lint/type/build and all 151 native browser cases pass. Four new deterministic cases verify exact geometry, detached ownership, other-cel/layer/embedded-image preservation, no-op dots and atomic stroke/point-cap refusal. Three new native cases reproduce missing controls before implementation, then verify exact project downloads, selected clone, Undo/Redo/reload, independently decoded PNG pixels, raw appearance/pose guards and phone-width controls. Independent read-only review found no critical or important defects.

Native verification uses available Chromium 153 with a temporary CPU-rendering wrapper. The published-head CI receipt will be recorded in the tracking issue. No learned motion or real-user evaluation is claimed. The broader animation product remains ACTIVE.
