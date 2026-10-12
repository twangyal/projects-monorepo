# Measured waistband milestone — 2026-10-12

Issue #192 adds an optional straight folded piece to the measured skirt. Stitch dimensions are waist plus extension by twice the finished height. The chosen seam allowance offsets all four edges; skirt hem allowance is separate. The printed fold and extension marks describe construction intent, not verified fastening mechanics.

The rigid preview and OBJ add a separate closed 32-quad cylinder sharing the shell's waist circle, extending from y=-height to y=0. Its overlap extension, thickness, fold, fastening and physical drape/body fitting are absent. This milestone supports further garment construction; Clothing remains ACTIVE toward the professional vision.

Domain checks independently confirm82×8cm stitching and84×10cm cutting for an80cm waist,2cm extension,4cm finished height and1cm seam allowance. Strict/accessor validation, detached complete projects, legacy optional absence, history, relative size inheritance, outward winding and actual128-vertex/64-face OBJ are covered.

Local gates pass63 unit tests, lint, typecheck/build and69 production Chromium153 workflows. New native checks import and retain complete work, measure actual SVG bounding boxes, decode actual OBJ vertices, download tiled/graded files, exercise Undo/Redo and autosave/reload, protect unrelated pointer/keyboard drafts and verify390px layout. Mobile screenshot inspected. A320-case extreme-grid diagnostic (both papers; optional heights/extensions and allowance extremes) reached144 tiles and591,558 UTF-8 bytes, below existing256-tile/2MB limits.

Native red/green caught an existing placement-change path that discarded invalid raw input on blur and allowed keyboard construction Apply to proceed. The invalid branch now preserves its raw value; valid editing and Reset placement retain existing synchronization. Review caught contradictory tile calibration wording; its conditional-copy regression failed before the fix and passes afterward. No existing test assertions or limits were weakened.

Physical printing, fastening construction, toile/manufacturing suitability and actual fitting are unverified. Exact published-head CI outcomes are recorded in the GitHub issue.
