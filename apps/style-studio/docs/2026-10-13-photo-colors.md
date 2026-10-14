# Photo color reading and outfit color notes — issue #224

## Intended outcome and gap

Style Studio should explain "how individual pieces work together". Before this milestone:
- photos were only displayed;
- every attribute was tagged by hand;
- the only explanation of an outfit was the fitted model's feature contributions over those tags.

Now a photographed piece gets measured colors and a palette suggestion with its reason, applied only by an explicit click, and a chosen outfit gets a plain-language account of how its pieces' actual colors relate.

## Method (`src/color-read.ts`)

1. **Sampling.** The photo is sampled on a 96×96 grid and converted to CIELAB (D65).
2. **Background.** The background is the per-channel median of the outer four grid rows and columns. Pixels within ΔE 14 of it are removed, which also removes the white padding added by photo normalization. If less than 3% of the photo remains, nothing is read and the panel says so.
3. **Clustering.** The rest is grouped by k-means with k ≤ 3, using deterministic farthest-point initialization and 12 iterations.
   - New centres are added only when they are at least ΔE 20 away.
   - Centres closer than ΔE 20 are merged, so noise, shading and compression do not split one color.
   - Clusters under 8% are dropped, and shares are renormalized.
4. **Naming.** Names come from the nearest of 26 reference colors and are approximate by design.
5. **Palette.** The rule applies to the main color:
   - **neutral** if chroma < 12;
   - **bright** if chroma > 50 and 35 < L* < 88;
   - otherwise **warm** for hue 345°–105° (red to yellow), else **cool**.
6. **Outfit notes.** These compare main colors pairwise:
   - lightness difference over 40 is strong contrast, under 12 is tonal;
   - for two colored pieces (chroma ≥ 15), a hue gap under 30° is analogous and 140° or more is complementary;
   - the notes also cover neutral anchors, an all-neutral look or a single accent, and pieces without readable photos.

In the browser, normalized photos are drawn at 96×96 and read once per immutable photo ID. No project data changes, so backups and older versions are unaffected.

## Verification (local)

- **Unit tests** (`tests/color-read.test.ts`, 4 new) use synthetic photos:
  - navy with ±6 noise reads as navy and cool, with a 100% share and the exact reason text;
  - tan reads warm, charcoal neutral and vivid red bright;
  - a cream garment on a green backdrop is read correctly;
  - white on white and malformed pixels are refused;
  - navy and beige stripes and red/blue color blocks give two colors;
  - palette and naming rules hold;
  - outfit notes come out exactly for navy, tan and black, plus all-neutral, single-accent and missing-photo cases.
- **Browser tests** (`tests/browser/color-read.spec.ts`, 2 new) run in production Chromium. Real PNG photos of garment silhouettes on white and off-white backdrops go through the actual normalization to 720×720 JPEG, then:
  - suggestions read cool, warm and neutral;
  - the tag is unchanged until the button is used;
  - an undetectable white garment is reported;
  - the outfit notes name the pieces;
  - the exported profile holds only the applied tags, and its piece fields are unchanged;
  - the phone width shows no horizontal overflow.
- `npm run check` passes 60 unit tests, lint and build. The full browser suite passes all 69 cases.

## Limits

- The tool does not recognize garments. It measures colors on the assumption that the garment differs from a plain backdrop. Busy scenes, people wearing the clothes, strong shadows or colored lighting will mislead it.
- Patterns are reported as their main colors, not as a pattern.
- Fit, style and formality are still tagged by hand.
- Color notes are descriptive rules. They are not trained on the person's labels and do not change the alignment score.
- No real wardrobe photos were evaluated in this environment; real-photo accuracy remains to be measured.
