# Style Studio

A local wardrobe and preference notebook. Add pieces you own, teach it with outfit examples you like or pass on, assess a tagged outfit, and save combinations for an occasion. Everything runs in your browser, including a small preference model fitted from your labels.

Photos are optional visual references. **You supply the tags**; this version does not recognize garments, analyze bodies, predict physical fit, or search a shopping catalog. Its score estimates alignment with the labels you supplied, not attractiveness or an objectively correct outfit.

## Run

Node.js 22.18+ is required; CI uses Node 24. From the repository root:

```sh
cd apps/style-studio
npm ci
npm run dev -- --host 127.0.0.1
```

Open the URL printed by Vite. For a production build:

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

There is no backend, API key, paid service, model download, or runtime network inference. Browser storage belongs to this exact browser profile and origin; changing the host or port starts a different storage location.

## Make it yours

1. Add tops, bottoms, and shoes under **Add wardrobe piece**. Name and explicitly tag each piece's palette, fit, style, and formality. An optional photo is normalized locally.
2. Use **Teach my taste** to label examples **Like** or **Pass**. The model needs at least eight examples, including three of each label. Before that, it explains the missing evidence and shows unranked outfit ideas.
3. Choose the tags for a new outfit and use **Assess this outfit**. Review the alignment score, label counts, and strongest feature contributions. These contributions explain this particular fitted model; they are not general fashion rules.
4. Use **Suggest looks** to combine one owned top, bottom, and pair of shoes. Choose a mode and occasion. Save a result, edit its name/notes, and rate it. Correcting a saved look's rating updates its existing example rather than counting the same vote twice.
5. Download an **outfit board** as a PNG, or **Export profile** as a complete JSON backup. Reopen the profile in the same browser or import the backup elsewhere.

**Load sample profile** provides original procedural wardrobe illustrations and explicitly labeled sample preferences. It replaces the active profile only through your action and can be undone. It never silently mixes sample labels into your own preferences.

Saved looks preserve snapshots of their pieces, including referenced photos. Later wardrobe edits or deletions do not rewrite the saved look. Removing a look leaves its independent preference example available to correct/delete. Deletions and profile replacement require confirmation; session Undo/Redo supports reversing successful edits.

## What the model and rules do

The learner uses fourteen declared attributes: four palettes, three fits, four styles, and three formality levels. Tagged examples have one active value in each group; saved outfit examples average the three pieces' vectors. It fits class-balanced, L2-regularized logistic regression in 600 deterministic full-batch steps. Trained parameters are derived again from validated examples rather than stored as trusted imported model weights.

The displayed 0–100 alignment score is the model's sigmoid output scaled for comparison. **It is not a calibrated probability or a validated measure of real-world taste accuracy.** Small, inconsistent, or narrow sets of tags limit its usefulness. Synthetic held-out tests check that the implementation learns the supplied pattern and responds to corrected labels; they do not establish how well these tags represent any particular person's wardrobe.

- **Match** ranks by learned alignment.
- **Explore** uses 35% alignment and 65% declared-feature novelty relative to liked examples. Novelty is a disclosed distance rule, not a second learned model.
- Occasion filtering is explicit: **Any** accepts all combinations; **Casual** requires every piece casual/smart and at least one casual; **Smart** requires every piece smart/formal; **Formal** requires all three formal. The app does not silently relax these rules when nothing matches.
- Up to three suggestions favor alternatives sharing at most one piece. A small eligible wardrobe may require shared pieces; the app reports that fallback. With insufficient labels, eligible ideas remain explicitly unranked.

## Local data and limits

One profile supports 36 pieces (12 per category), 80 labeled examples, 30 saved looks, and 20 photo assets. Names are limited to 80 characters, captions to 160, and notes to 500. An exported/imported UTF-8 JSON profile is limited to 8 MiB. Unknown or malformed fields, ambiguous duplicate JSON keys, broken references, invalid feature vectors, and invalid photo content are rejected before replacing the active profile.

Input photos must be static JPEG, PNG, or WebP, at most 8 MiB, 16 megapixels, and 8,192 pixels per side. Normalization contains the image in a white 720 × 720 square and re-encodes it as JPEG, at most 200 KiB. This removes source metadata and may discard transparency; it is a reference thumbnail, not an original-photo archive. SVG, GIF, APNG, and animated WebP are unsupported. PNG outfit boards are 1200 × 1000 and contain saved photos or original procedural piece illustrations, declared tags, and text; they are collages, not virtual try-on.

IndexedDB autosave is local to the browser. Failed/unavailable storage leaves the in-memory profile editable and reports the problem; **export a JSON backup before closing**. Browser storage alone is not a backup. The app preserves corrupt saved data rather than silently overwriting it with an empty profile. Accepted saves run in order, and late startup/import/photo work cannot overwrite newer edits.

Undo/redo is session-only: at most 20 snapshots including the current profile, with a 24 MiB serialized-history budget. Large profiles have fewer undo steps. Unreferenced photos are collected from the current profile, while saved look and example references keep their assets.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

`check` runs Node unit tests, ESLint, type checking, and a production build. Individual commands are `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build`. To use an existing Chromium executable:

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

Playwright uses production assets on port 4240. `STYLE_STUDIO_TEST_HARNESS=1` adds isolated storage/image harness entries for browser verification; normal builds omit them. Verification covers real IndexedDB and image decoding/export as well as learning, domain bounds, and the complete user flow. No account, third-party image service, or downloaded model is needed.

The completed local milestone passes 51 unit tests and 30 production Chromium tests, plus ESLint, TypeScript and a production build. Browser checks use real image decoding, PNG pixels and IndexedDB, including storage failures, corrupt-record recovery, concurrent operation cancellation, and the complete personal-learning workflow. An independent orientation review compared all eight EXIF orientations across JPEG/PNG/WebP, rectangular and square sources: all 48 cases matched independently transformed reference pixels. These checks validate the implementation, not the predictive quality of a particular person's training examples.


Issue [#68](https://github.com/twangyal/projects-monorepo/issues/68) guards failed IndexedDB schema creation. Native regression tests first reproduced an uncaught private browser exception, then verified sanitized backup guidance, no uncaught page error and successful save/reopen after retry. The complete gate passed 51 unit and 30 production Chromium cases, lint, type checking and build at [`82a090b`](https://github.com/twangyal/projects-monorepo/actions/runs/37198623281). See [the setup verification record](docs/2026-10-04-storage-setup-verification.json).
