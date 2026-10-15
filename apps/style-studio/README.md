# Style Studio

A local style and wardrobe notebook. Start with pictured outfit choices, see example inspiration without typing, then add pieces you own and build wearable looks. Everything runs in your browser, including a small preference model fitted from saved labels.

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

## Start with pictures

Choose **Choose pictured styles** to browse twelve original outfit illustrations. Use **Like**, **Pass**, or **Skip**; no minimum is required. Each Like/Pass saves one correctable opinion, never example clothes or supplied sample votes. **Clear** removes your opinion for that picture; Undo/Redo can reverse it. **See inspiration** shows up to three example outfits influenced by saved profile labels. These are inspiration, not clothes you own or shopping listings. You can also skip directly to unranked examples.

With sparse evidence, inspiration uses a disclosed tag-overlap rule (average similarity to Likes minus average similarity to Passes across palette, fit, style and formality). It is not a fitted model or recognition of the picture. Once the existing eight-example / three-Like / three-Pass gate is met, inspiration uses the same fitted preference model as the rest of the app. Imported labels are used as supplied; known sample labels remain explicitly identified as not your own preferences. Passing every pictured outfit offers a clear empty state rather than inventing a match.

Picture opinions use the existing schema-1 example format and travel in complete JSON backups and autosave. The bundled catalog uses stable identities; changing a vote updates that same record. An unrelated imported record with a catalog identity is protected rather than overwritten. New users do not need wardrobe pieces, tags or a profile name before seeing inspiration. Returning profiles open directly to inspiration; a local presentation preference remembers skipping the introductory screen even with an empty profile. If that optional preference cannot be stored, the profile remains usable.

**Inspiration**, **Picture preferences**, **Wardrobe**, and **Profile & backup** are the main screens. **More tools** reveals **Your taste**, **Build a look**, **Suggest owned looks**, and **Saved looks**. **Expand workspace** reveals the existing full editor; **Focus workspace**, Back, Escape, and the keyboard skip link provide clear navigation. Original editor fields, raw photo drafts, selections and async operations remain mounted. A screen explicitly chosen during restore stays selected when photo decoding finishes. Undo/Redo, save status, errors and pending-operation cancellation remain available; storage recovery appears globally when needed and is always reachable in Profile & backup. Switching screens alone neither applies fields nor cancels owned work.

The pictures are original repository-native SVG garment illustrations. No Pinterest images are downloaded, no account is required, and no external image or inference request is made. See [visual source assessment](docs/2026-10-15-visual-sources.md) and [verification](docs/2026-10-15-visual-onboarding.md). Actual intended-user taste relevance and physical garment fit remain unvalidated.

## Add your own wardrobe and refine your taste

1. Add tops, bottoms, and shoes under **Add wardrobe piece**. Name and explicitly tag each piece's palette, fit, style, and formality. An optional photo is normalized locally.
2. Use **Teach my taste** to label examples **Like** or **Pass**. The model needs at least eight examples, including three of each label. Before that, it explains the missing evidence and shows unranked outfit ideas.
3. Choose the tags for a new outfit and use **Assess this outfit**. Review the alignment score, label counts, and strongest feature contributions. These contributions explain this particular fitted model; they are not general fashion rules.
4. Under **Build a look**, explicitly choose an owned top, bottom and pair of shoes. **Assess chosen outfit** previews their actual photos or illustrations and scores their averaged tags without editing your profile. Name it, add notes and **Save chosen outfit** to preserve independent piece/photo snapshots. Saving does not imply Like or Pass; rate the saved look explicitly. Missing or deleted selections require a replacement, and insufficient training evidence remains unscored.
5. Use **Suggest looks** to combine one owned top, bottom, and pair of shoes. Choose a mode, occasion and wear-history choice. **Avoid previously worn outfits** excludes exact top/bottom/shoes identities recorded in any saved look’s wear diary; repeated entries or duplicate saved looks count that combination once. Unrecorded saved looks remain eligible. This is a disclosed filter, not learned feedback, recency weighting or an inferred vote. If every occasion-valid combination has been worn, explicitly include previous outfits or add different pieces. Changing choices or committed wear history invalidates old suggestions until you suggest again, keeping their unapplied names visible. Save a result, edit its name/notes, and rate it. Correcting a saved look's rating updates its existing example rather than counting the same vote twice.
6. In each saved look, record a **Wear date**, **Wear occasion** and **Wear notes**, then **Save wear entry**. Revisit the newest dates first; edit a particular entry or confirm its deletion. Use Like or Pass separately to teach your taste. Wear counts are self-recorded history and do not automatically create votes or alter the fitted model.
7. Download an **outfit board** as a PNG, or **Export profile** as a complete JSON backup. Reopen the profile in the same browser or import the backup elsewhere.

**Load sample profile** provides original procedural wardrobe illustrations and explicitly labeled sample preferences. It replaces the active profile only through your action and can be undone. It never silently mixes sample labels into your own preferences.

Saved looks preserve snapshots of their pieces, including referenced photos. Later wardrobe edits or deletions do not rewrite the saved look. Removing a look leaves its independent preference example available to correct/delete. Deletions and profile replacement require confirmation; session Undo/Redo supports reversing successful edits. Wear entries belong to the independent saved look and survive changes to the current wardrobe. Dates use real Gregorian YYYY-MM-DD values (years 0001–9999); notes allow 500 characters, occasion 80, with at most 20 entries per look and 100 across the profile. Existing profiles without diaries retain their original fields; optional diary records travel in complete JSON backups and local recovery. Older app versions will reject the added fields and protect their saved copy rather than silently dropping diary data.

## Read colors from your photos

When you choose a **Reference photo** for a piece, Style Studio reads its colors locally and shows **Colors read from this photo**:
- up to three main colors, with approximate names and shares of the garment;
- a **Suggested palette** with its reason, for example: "Main color navy (62% of the piece): green-to-blue-to-violet hue."

**Use suggested palette** applies the suggestion to the form; your tag is never changed otherwise. Save the piece as usual.

When you **Assess chosen outfit**, **How the colors work together** compares the main colors of the pieces that have photos:
- light–dark contrast (strong, moderate or tonal);
- hue relations between colored pieces (analogous, complementary or contrasting);
- neutral anchors, and whether the look is all-neutral or has a single color accent.

How it works and its limits:

- The background is estimated from the photo's border and removed; the remaining pixels are grouped into at most three colors in CIELAB space. Everything happens in your browser, and nothing is stored: readings are recomputed from the saved photos, so profiles and backups are unchanged.
- Palette rules:
  - **neutral** when saturation is very low;
  - **bright** when highly saturated at medium lightness;
  - otherwise **warm** (red to yellow hues) or **cool** (green to blue to violet).
- These are fixed color rules, not learned recognition or a judgement of taste, and they are separate from your fitted preference model.
- A garment the same color as its backdrop (white on white) cannot be separated, and the panel says so. Lighting, shadows, patterns and busy backgrounds affect readings. Photograph pieces flat on a plain, contrasting surface for the most useful result, and keep your own tag when it looks wrong.

See [color reading verification](docs/2026-10-13-photo-colors.md).

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

Each page now checks the complete saved copy before writing. If another tab has
changed it, autosave stops and keeps both the newer saved profile and this page's
current work. Continue editing or use **Export profile** to keep a complete backup,
including photos. Your forms, unsubmitted photos and session Undo/Redo remain
available while the saved copy is protected.

**Reload saved profile** deliberately discards this page's unsaved profile,
unapplied fields and session history after confirmation and successful photo
checks. **Replace saved copy** first reviews the current saved profile, then asks
before replacing it with this page's complete committed profile. Unapplied fields
and unsubmitted photos are excluded and stay in the editor. If another tab saves
again during that review, replacement refuses and requires a fresh review.
New profile, sample loading and JSON import remain reversible local edits; they
do not bypass protection of a conflicting or unreadable saved copy.

A confirmed storage failure can offer **Retry saving**. An unknown result or
ten-second storage deadline keeps the copy protected until explicit recovery;
it never claims a save succeeded. This release upgrades the local database to
version 2 to prevent older clients from writing without these checks. Close old
tabs if the upgrade is blocked, and use the current app build to reopen it.
The upgrade itself preserves the existing profile; portable JSON stays schema 1.

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

Playwright uses production assets on port 4240; `STYLE_TEST_PORT` selects another unused port. `STYLE_STUDIO_TEST_HARNESS=1` adds isolated storage/image harness entries for browser verification; normal builds omit them. Verification covers real IndexedDB and image decoding/export as well as learning, domain bounds, and the complete user flow. No account, third-party image service, or downloaded model is needed.

The completed local milestone passes 51 unit tests and 30 production Chromium tests, plus ESLint, TypeScript and a production build. Browser checks use real image decoding, PNG pixels and IndexedDB, including storage failures, corrupt-record recovery, concurrent operation cancellation, and the complete personal-learning workflow. An independent orientation review compared all eight EXIF orientations across JPEG/PNG/WebP, rectangular and square sources: all 48 cases matched independently transformed reference pixels. These checks validate the implementation, not the predictive quality of a particular person's training examples.


Issue [#68](https://github.com/twangyal/projects-monorepo/issues/68) guards failed IndexedDB schema creation. Native regression tests first reproduced an uncaught private browser exception, then verified sanitized backup guidance, no uncaught page error and successful save/reopen after retry. The complete gate passed 51 unit and 30 production Chromium cases, lint, type checking and build at [`82a090b`](https://github.com/twangyal/projects-monorepo/actions/runs/37198623281). See [the setup verification record](docs/2026-10-04-storage-setup-verification.json).

Issue [#116](https://github.com/twangyal/projects-monorepo/issues/116) prevents a
reproduced stale-tab overwrite of complete photos, ratings and saved looks.
Version 0.2.0 passes **51 unit and 56 production Chromium cases**, lint, type
checking and build locally and in both [push](https://github.com/twangyal/projects-monorepo/actions/runs/37248358130) and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37248361845) CI at `285266b`. The [CI receipt](docs/2026-10-05-saved-copy-ci.json) verifies the actual PR checkout has the identical implementation tree. Native checks exercise actual transaction aborts,
old-client fencing, corrupt/missing records, ten-second deadlines, competing
writers, reviewed replacement and preserved editor drafts. The [verification
receipt](docs/2026-10-05-saved-copy-verification.json) retains the original data-loss
reproduction and both corrected test-wording failures.

The first original maximum-capacity run preserves 36 pieces, 80 ratings, 30 saved
looks and 20 distinct 720 × 720 JPEGs of exactly 200 KiB each through conflict,
Undo/Redo, stale replacement refusal and fresh replacement. A **5,544,230-byte**
complete backup survives a new Chromium process byte-for-byte. Two actual PNG
boards pass independent image checks, and four full snapshots demonstrate the
24 MiB history bound. Exact 8 MiB input uses trailing JSON whitespace; JPEG
capacity uses declared harmless comment padding. These are capacity and
correctness checks, without claims about photographic complexity, peak memory,
general latency or fashion accuracy. See [the complete maximum
receipt](docs/2026-10-05-saved-copy-maximum.json).

To repeat that optional acceptance, install Python 3 with Pillow and a Chromium
browser. Build normally, then serve `dist` on a loopback origin in another
terminal (for example `python3 -m http.server 4312 --bind 127.0.0.1 --directory dist`).
Use new fixture and output directories; existing evidence is never overwritten:

```sh
STYLE_CONFLICT_FIXTURES=/tmp/style-capacity-fixtures \
  node scripts/smoke_saved_copy_conflicts.mjs --fixtures-only
STYLE_CONFLICT_FIXTURES=/tmp/style-capacity-fixtures \
  STYLE_CONFLICT_OUTPUT=/tmp/style-capacity-results \
  STYLE_CONFLICT_ORIGIN=http://127.0.0.1:4312 CHROMIUM_PATH=/usr/bin/chromium \
  node scripts/smoke_saved_copy_conflicts.mjs --run-prepared
```

The runner owns its browser processes and leaves the supplied server untouched.

Issue [#184](https://github.com/twangyal/projects-monorepo/issues/184) adds chosen wardrobe composition. The complete gate passes 51 unit and 60 native Chromium cases, lint, types and build. Native checks compare the independently computed score, complete JSON before/after assessment, saved snapshots after wardrobe deletion, Undo/Redo, reopen, actual photo pixels in the downloaded PNG, insufficient-evidence behavior, mobile missing selections and cancellation of a held real import. See [the verification record](docs/2026-10-11-chosen-outfits/README.md). Style Studio remains ACTIVE against the revised product direction.

Issue [#185](https://github.com/twangyal/projects-monorepo/issues/185) adds the actual-wear diary without implicit feedback. The complete local gate passes 54 unit and 65 native browser cases, lint, types and build. See [the wear verification record](docs/2026-10-11-wear-diary/README.md) for complete profile, native storage, raw draft, conflict and boundary evidence.

Issue [#186](https://github.com/twangyal/projects-monorepo/issues/186) connects recorded wear to explicit repeat avoidance. The complete gate passes 56 units and 67 native browser cases, lint/types/build; independent enumeration, duplicate/unknown/order exclusions, unchanged logistic scores, all-excluded mobile results, explicit save and stale-name preservation are covered in [the repeat-filter verification record](docs/2026-10-11-wear-filter/README.md).
