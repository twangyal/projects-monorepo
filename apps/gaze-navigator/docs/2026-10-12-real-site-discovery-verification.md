# Real-site discovery — issue #207

## Gap

Context capture used `document.querySelectorAll` and `document.elementFromPoint`.
On real websites that misses three kinds of control:

- controls inside web components, where `elementFromPoint` returns only the
  shadow host;
- embedded same-origin forms in iframes;
- `div`/`span` "buttons" that only have script handlers and a pointer cursor.

What the user saw in the circle was not what the navigator could act on.

## Changes (`src/web/page-context.js`, `src/web/overlay.js`)

- Discovery walks every open shadow root and same-origin frame. The overlay's
  own shadow root is excluded.
- `deepElementFromPoint` descends through shadow roots and frames, and occlusion
  checks use composed containment across shadow boundaries.
- `viewportRect` converts frame-relative rectangles to top-level coordinates for
  distance and outline drawing.
- `aria-labelledby` resolves inside the element's own root.
- Inferred clickables: within the circle, the element that sets
  `cursor: pointer` (its parent does not), with a readable name and no real
  control inside, is labeled "Clickable".
- Cross-origin frames intersecting the circle are listed, without a number, as
  content the navigator cannot reach.
- Pointer movement over same-origin frames is translated back to page
  coordinates.
- Focus inside shadow roots and frames is followed for dictation.
- Context capture is throttled to 100 ms and now always runs once more when the
  interval ends. Before this, a pointer that stopped within 100 ms of the
  previous capture left a stale context list. This bug was found while building
  the tests.
- The panel is more compact: tracking and settings sit in a disclosure, and the
  element list opens by default only on screens taller than 700 px. On a
  390×740 screen the previous panel covered an embedded form's button, which
  then correctly counted as obscured.
- The practice site gained a Help page with a shadow-DOM feedback widget,
  script-only topic cards, a same-origin iframe form and a sandboxed
  (opaque-origin) map frame.

## Verification (2026-10-12, local)

Node.js 22.22.0, Playwright 1.63.0, preinstalled Chromium 141.0.7390.37:
`npm test` 117 passing, `npm run build` (69-file syntax check plus test
extension build), and all 156 native Chromium cases at four viewports.

The new Help-page case covers:

- activating a pointer-cursor card;
- pressing a button inside a web component;
- dictating into a shadow-DOM input;
- dictating into an iframe textarea and confirming the iframe's submit;
- outline coordinates for frame elements;
- the unreachable-frame notice.

## Limits

- Closed shadow roots and cross-origin frames remain unreachable by design.
- In pointer mode, cross-origin frames receive no events, so the circle stops
  at their edge. Camera gaze has no such limit.
- Inferred clickables are heuristic. The "Clickable" role tells the user they
  were inferred.
