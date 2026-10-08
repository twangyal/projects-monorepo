# Style Studio: learn a person's stated outfit preferences

Idea #12, issue #24, `apps/style-studio`, branch Astra. The user's autonomous instructions authorize these product decisions and the assigned parallel execution; no additional approval is required. Implementation starts only after root has made the Duet milestone durable. Do not modify either excluded project or duplicate the other writer's Shot Studio work.

## Complete milestone and truthful scope

Build a local browser wardrobe and preference notebook: add owned pieces → label tagged outfit examples Like/Pass → fit a real personal preference model → assess a manually tagged new outfit → suggest three owned-piece combinations for a mode and occasion → save, annotate, rate, export and reopen looks. Users explicitly supply all visual tags. Uploaded photos are references, not inputs to automatic garment recognition, body analysis or image embeddings.

The fitted classifier is actual machine learning from the user's examples. Occasion eligibility and exploration novelty are disclosed rules. Scores express estimated alignment with the supplied labels, not calibrated probabilities, objective attractiveness, fit, body suitability or a professional styling judgment. Synthetic held-out tests establish algorithm behavior, not accuracy for a person's real wardrobe. No pretrained model, remote inference, account, paid service or network save is needed. The sample profile uses original procedural illustrations and clearly identified sample labels; it is never silently added to a user's training data.

## Architecture and limits

Use TypeScript/Vite, a DOM UI, a pure domain, pure feature/model functions, IndexedDB, a bounded session history, native image decoding and Canvas PNG export. Node.js 22.18+ is sufficient locally; CI uses Node 24. Runtime is entirely in the browser; use the repository's npm unit/lint/typecheck/build and production Playwright conventions. No runtime ML package is necessary for a 14-feature linear classifier. Keep this app independent rather than extracting shared infrastructure from superficially similar apps.

One schema-1 profile contains at most **36 pieces**, at most **12 in each of top/bottom/shoes**, **80 labeled examples**, **30 saved looks**, and **20 photo assets**. Each stored photo is a **720 × 720 JPEG**, at most **200 KiB of decoded JPEG bytes**. The entire serialized UTF-8 profile is at most **8 MiB**. Imported source photos are JPEG/PNG/static WebP, at most **8 MiB**, at most **16 megapixels** and **8,192 pixels per side** before normalization; reject SVG, GIF, APNG, animated WebP, unsupported signatures and malformed files. Normalize by containing the image within a white square without stretching and re-encode, removing source metadata. Reduce JPEG quality if needed; reject rather than publish output over the stored cap. These bounds concern encoded/serialized content, not a promise about browser peak memory.

Undo/redo retains at most **20 total snapshots including current**, bounded to **24 MiB of serialized UTF-8 snapshots**. Large profiles may therefore have fewer undo steps. Editing after undo clears redo. Persistence errors remain visible while in-memory editing and explicit exports stay usable. Browser storage is not a backup; provide validated JSON import/export. Photos stay local. No import starts an external fetch.

## Shared contracts: `src/types.ts`

The domain owner creates this contract file first; all other owners consume it without independently redefining public types. The contract freezes before parallel app implementation. IDs are 32 lowercase hexadecimal characters; use `crypto.getRandomValues` to create new IDs. Every imported object has exactly its specified keys, IDs are unique across all entities, strings contain valid Unicode and no unsupported controls, and all numbers are finite. Trim and bound user-facing names; preserve notes/captions as text with newline/tab support. Reject unknown fields and unsupported versions.

```ts
export type Category = 'top' | 'bottom' | 'shoes';
export type Palette = 'neutral' | 'warm' | 'cool' | 'bright';
export type Fit = 'fitted' | 'regular' | 'relaxed';
export type Style = 'minimal' | 'classic' | 'sporty' | 'playful';
export type Formality = 'casual' | 'smart' | 'formal';
export interface Tags { palette: Palette; fit: Fit; style: Style; formality: Formality }
export type Label = 'like' | 'pass';
export type Mode = 'match' | 'explore';
export type Occasion = 'any' | 'casual' | 'smart' | 'formal';
export type FeatureVector = readonly [number, number, number, number,
  number, number, number, number, number, number, number, number, number, number];
export interface PhotoAsset {
  id: string; mime: 'image/jpeg'; width: 720; height: 720; dataUrl: string;
}
export interface Piece { id: string; name: string; category: Category; tags: Tags; photoId: string | null }
export interface PreferenceExample {
  id: string; caption: string; label: Label; origin: 'tagged' | 'outfit';
  features: FeatureVector; photoId: string | null; sourceLookId: string | null;
}
export type OutfitPieces = readonly [Piece, Piece, Piece]; // top, bottom, shoes
export type PieceIds = readonly [string, string, string]; // same order
export interface SavedLook { id: string; name: string; notes: string; pieces: OutfitPieces }
export interface Project {
  schemaVersion: 1; title: string; pieces: Piece[]; examples: PreferenceExample[];
  looks: SavedLook[]; photos: PhotoAsset[];
}
export interface Counts { total: number; likes: number; passes: number }
export interface TrainedModel {
  status: 'trained'; counts: Counts; weights: readonly number[]; intercept: number;
  likedCentroid: FeatureVector; steps: 600; loss: number;
}
export interface InsufficientModel { status: 'insufficient'; counts: Counts; reason: string }
export type ModelResult = TrainedModel | InsufficientModel;
export interface FeatureContribution {
  index: number; name: string; value: number; weight: number; contribution: number;
}
export interface TasteScore { score: number; contributions: FeatureContribution[] }
export interface Candidate {
  pieceIds: PieceIds; features: FeatureVector; taste: TasteScore | null;
  novelty: number | null; rankScore: number | null;
}
export interface Suggestions {
  candidates: Candidate[]; eligibleCount: number; ranked: boolean;
  diversityFallback: boolean; reason: string | null;
}
```

Export ordered constants `PALETTES`, `FITS`, `STYLES`, `FORMALITIES`, `CATEGORIES`, `FEATURE_NAMES`, `ID_PATTERN` and `LIMITS` from `types.ts`. Array orders follow the unions as written. `FEATURE_NAMES` is exactly `palette:neutral`, `palette:warm`, `palette:cool`, `palette:bright`, `fit:fitted`, `fit:regular`, `fit:relaxed`, `style:minimal`, `style:classic`, `style:sporty`, `style:playful`, `formality:casual`, `formality:smart`, `formality:formal`. `LIMITS` keys are `pieces:36`, `piecesPerCategory:12`, `examples:80`, `looks:30`, `photos:20`, `photoBytes:204800`, `photoSide:720`, `projectBytes:8388608`, `sourcePhotoBytes:8388608`, `sourcePhotoPixels:16000000`, `sourcePhotoSide:8192`, `historySnapshots:20`, `historyBytes:25165824`.

Profile title, piece names and look names allow 1–80 characters; example captions 1–160; notes 0–500. A piece or tagged example may omit a photo by using null. Every non-null photo ID must exist. Saved looks contain detached piece snapshots, so their piece IDs need not remain in the live wardrobe; each look has exactly one piece per category in the prescribed order. Snapshot tags/names and referenced photo assets remain intact after wardrobe changes/deletion. Reusing a live piece ID in a saved snapshot is expected; global uniqueness applies to root entities, not repeated snapshots. `sourceLookId` is an attribution/deduplication key, not a required live foreign key: deleted looks do not delete their independent rating examples.

Examples have a uniform shape without a redundant tags field. For `origin:'tagged'`, each feature group is exactly one-hot and `sourceLookId` is null. For `origin:'outfit'`, feature values must be exactly 0, 1/3, 2/3 or 1, each group sums to one within 1e-8, `sourceLookId` is a valid ID, and `photoId` is null. These are the average of three piece vectors when created by the app; validation checks this representable shape, not the authenticity of a user-edited JSON claim. A manual example's attributes can be displayed by reversing its one-hot vector. Persist neither trained weights nor scores; derive them from validated examples after load.

## Features and real preference learning: `src/features.ts`, `src/model.ts`

Public exports:

```ts
// features.ts
export function featuresFromTags(tags: Tags): FeatureVector;
export function tagsFromFeatures(features: FeatureVector): Tags; // one-hot only
export function averageFeatures(pieces: OutfitPieces): FeatureVector;
export function validateFeatures(value: unknown, origin: 'tagged' | 'outfit'): FeatureVector;
// model.ts
export function trainPreferenceModel(examples: readonly PreferenceExample[]): ModelResult;
export function scorePreference(features: FeatureVector, model: TrainedModel): TasteScore;
export function assessOutfit(features: FeatureVector, model: ModelResult): TasteScore | null;
export function generateAlternatives(pieces: readonly Piece[], model: ModelResult,
  options: { mode: Mode; occasion: Occasion }): Suggestions;
```

Training requires at least **8 examples**, including **3 Like and 3 Pass**. Otherwise return `insufficient` with counts and actionable guidance; never substitute invented learned scores. Begin 14 weights and intercept at zero and run exactly **600 full-batch steps**, learning rate **0.2**, L2 coefficient **0.1** on weights only. Minimize the average of the two class-average binary cross-entropies plus `0.1/2 * sum(weights²)`: each example's loss/gradient weight is `1/(2 * numberInItsClass)`. Use numerically stable sigmoid/loss calculations. No randomness, minibatches or platform-dependent training package. Validate inputs, never mutate examples, and report finite final objective. `likedCentroid` is the arithmetic mean of liked feature vectors. Canonically sort examples by ID before accumulation so reordering a profile does not change results.

Taste score is `Math.round(100 * sigmoid(intercept + dot(weights, features)))`, bounded 0–100. Explain up to three nonzero feature contributions `weights[i] * features[i]`, sorted by absolute magnitude then index; these explain the linear model, not independent causal fashion principles. Show label counts and a visible small-data/uncalibrated-score warning. `assessOutfit` returns null for insufficient data.

Generate all top × bottom × shoes combinations, at most **12³ = 1,728**. Validate counts and categories rather than accepting an unbounded external collection. Hard occasion filters use the declared tags: `any` permits all; `casual` requires every piece casual/smart and at least one casual; `smart` requires every piece smart/formal; `formal` requires every piece formal. Explain this rule and empty results; never secretly relax it.

For a trained model, match ranks by score/100. Explore ranks by `0.35 * score/100 + 0.65 * novelty`, where novelty is L1 distance from the liked centroid divided by **8** (four groups each have maximum distance two). Novelty is a disclosed feature-distance rule, not another learned model. Break equal ranking scores lexicographically by the joined piece IDs. For insufficient data, scores/novelty/rankScore are null, `ranked:false`, and eligible combinations appear in lexical ID order as explicitly unranked outfit ideas. Both modes may still show occasion-valid ideas; they must not claim personalized ranking.

Return at most three alternatives. Select the first ranked candidate, then candidates sharing at most **one piece with every already selected alternative**. If fewer than three can meet that condition, fill from the remaining ordered candidates and set `diversityFallback:true`; state that the available wardrobe required shared pieces. Use fewer than three only when fewer than three eligible combinations exist. `eligibleCount` counts all hard-filter-valid combinations before diversity selection.

## Domain and coherent edits: `src/domain.ts`, `src/demo.ts`

All domain mutations return a newly validated detached Project, preserve the caller on error and run unused-photo collection before final validation. New photo publication is atomic with the piece/example that references it. Public inputs omit generated IDs. Exact exports:

```ts
export function newId(): string;
export function createProject(title?: string): Project;
export function validateProject(value: unknown): Project;
export function parseProject(text: string): Project;
export function serializeProject(project: Project): string;
export function setTitle(project: Project, title: string): Project;
export function addPiece(project: Project,
  input: { name: string; category: Category; tags: Tags; photoId: string | null }, photo?: PhotoAsset): Project;
export function updatePiece(project: Project, id: string,
  patch: Partial<Pick<Piece, 'name' | 'category' | 'tags' | 'photoId'>>, photo?: PhotoAsset): Project;
export function deletePiece(project: Project, id: string): Project;
export function addTaggedExample(project: Project,
  input: { caption: string; label: Label; tags: Tags; photoId: string | null }, photo?: PhotoAsset): Project;
export function setExampleLabel(project: Project, id: string, label: Label): Project;
export function deleteExample(project: Project, id: string): Project;
export function saveLook(project: Project, pieceIds: PieceIds, name: string, notes?: string): Project;
export function updateLook(project: Project, id: string, patch: { name?: string; notes?: string }): Project;
export function deleteLook(project: Project, id: string): Project;
export function rateLook(project: Project, id: string, label: Label): Project;
export function collectUnusedPhotos(project: Project): Project;
// demo.ts
export function createDemoProject(): Project;
```

Defaults: `createProject()` title is `My style`, notes default empty. Category changes obey destination quotas. Missing IDs and invalid/unknown patch fields reject the edit; never delete a different object. Saving captures the current three pieces and keeps their assets. `rateLook` creates an outfit-origin example from the snapshot mean, captioned with the look name, or updates the existing example identified by sourceLookId; changing a vote does not consume another example slot. An existing example can be relabeled at the quota. Removing a look leaves that example and its features intact. Asset GC traces live pieces, tagged-example photos and saved piece snapshots; only unreferenced assets disappear.

`validateProject` checks strict shapes, bounds, IDs, normalized features and references, delegates synchronous normalized JPEG validation to `photo-header.ts`, and returns a detached copy. `parseProject` checks the UTF-8 text byte limit before JSON parsing; malformed/nested inputs fail with user-readable errors and no publication. `serializeProject` revalidates and enforces the same byte limit. Reject duplicate JSON object keys rather than allowing ambiguous last-key wins. Unknown/corrupt imported data is not silently migrated or discarded. Actual image decoding is an additional asynchronous import/startup gate, not a substitute for these checks.

The demo contains six procedural pieces (two per category), twelve explicitly captioned sample examples (six Like/six Pass), no photo assets, and one valid saved look. Different sample features allow the genuine learner to demonstrate ranking. Loading it requires explicit replacement intent and is undoable; ordinary startup never adds it.

## Photos and real board export: `src/photo-header.ts`, `src/images.ts`

Public exports:

```ts
// photo-header.ts: pure, imports only shared types/constants
export function validatePhotoAsset(value: unknown): PhotoAsset;
// images.ts
export function normalizePhoto(source: Blob, id: string, signal?: AbortSignal): Promise<PhotoAsset>;
export function validateProjectPhotos(project: Project, signal?: AbortSignal): Promise<void>;
export function exportLookPng(project: Project, lookId: string, signal?: AbortSignal): Promise<Blob>;
```

`validatePhotoAsset` checks exact fields, canonical `data:image/jpeg;base64,...`, canonical base64 syntax, decoded byte cap, JPEG signature and bounded marker parsing through the SOF dimensions. Stored fields and actual header must both be 720 × 720. For source normalization inspect supported headers/animation flags and dimensions before decoding, then confirm actual decoded dimensions agree; MIME/file extensions alone are insufficient. Handle corrupt/truncated markers and source limit violations. Decode/re-encode, and confirm generated JPEG dimensions/byte size before returning it. `validateProjectPhotos` actually decodes every stored asset and confirms dimensions; reject decode failures while keeping the current profile. Close bitmaps, revoke temporary object URLs and check cancellation after every awaited operation, including late decode completion.

Export a genuine **1200 × 1000 PNG** with white background, profile/look titles, top/bottom/shoes cards, names, declared tags and notes. Draw normalized photos when present; otherwise draw original procedural garment illustrations colored by declared palette. Look resolution uses the saved snapshots, not current wardrobe pieces. Wrap bounded text with an explicit ellipsis if it cannot fit. Use Canvas text, never HTML injection or a screenshot of the UI. Validate the project, resolve the selected look by ID, decode real images and return a nonempty `image/png` Blob. Aborted/failed export publishes no download. Browser tests independently decode the PNG and inspect size plus nonblank photographic/procedural regions; synthetic images establish pipeline behavior, not virtual try-on or style accuracy.

## Persistence and history: `src/storage.ts`, `src/history.ts`

```ts
export interface ProjectStore {
  load(): Promise<Project | null>;
  save(project: Project): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
export function openProjectStore(): Promise<ProjectStore>;
export class ProjectHistory {
  constructor(initial: Project);
  get current(): Project;
  get canUndo(): boolean;
  get canRedo(): boolean;
  apply(next: Project): boolean;
  undo(): Project | null;
  redo(): Project | null;
}
```

IndexedDB database `style-studio`, version 1, object store `profiles`, singleton key `current`. Save detached validated snapshots captured when `save` is called, using an internal ordered queue for save/clear; resolve only on transaction completion. A failed operation does not poison later queued operations. `close` stops new operations, waits for accepted work, and closes the database. `load` structurally validates stored data and surfaces corruption without overwriting it. No silent persistent fallback when IndexedDB is unavailable; report memory-only mode and offer export.

History detaches every boundary, rejects invalid edits without changing stacks, ignores identical serialized states, clears redo after a new edit, and trims oldest undo snapshots to both bounds while retaining current. Undo/redo return detached snapshots or null at boundaries. The current getter returns a detached copy; callers cannot mutate retained history. Byte bounds count serialized snapshots, not object-heap estimates. History is session-only and not exported.

Root owns the startup stale-load guard: capture an edit generation before asynchronous load/decode; apply the result only if no user edit/import/demo/new-profile action has occurred. Corruption is reported before any default autosave replaces the stored profile. Root also owns async photo/import/export cancellation and generation checks. A whole-profile import is parsed, structurally validated and actually image-decoded off the live state, then published once through history only if the operation still owns its generation. Rejected, cancelled or stale imports leave the current project, history and autosave unchanged. Save failure does not roll back user edits; show retry/export guidance.

## UI and parallel ownership

Root implements an accessible wardrobe/example/assessment/alternatives/saved-looks workspace. Stable action labels: **Add wardrobe piece**, **Teach my taste**, **Assess this outfit**, **Suggest looks**, **Save look**, **Download outfit board**, **Export profile**, **Import profile**, **Undo**, **Redo**, **Load sample profile**. Rating labels are **Like** and **Pass**. Show mode/occasion explanations, counts, insufficient-data guidance, fallback diversity and photo privacy plainly. Saved look name/notes remain editable. Deleting pieces, examples, saved looks or replacing the profile requires explicit selected-object confirmation; invalid forms preserve drafts. Avoid full DOM replacement that loses focused input or unsaved notes during rating/model updates. Preview images use local data only; render text with DOM textContent. Cancel/ignore stale uploads and imports, and prevent cancelled exports from creating downloads.

Ownership after root's Duet gate:

- **git_history_review:** `types.ts`, `domain.ts`, `demo.ts`, their unit tests; publishes contracts first.
- **git_reader:** `features.ts`, `model.ts`, their unit tests; no persistence/UI code.
- **recorder:** `storage.ts`, `history.ts`, their unit tests; no root startup/DOM code.
- **audio_engine:** `photo-header.ts`, `images.ts`, pure header tests and image/export browser checks coordinated with the browser reviewer.
- **next_project_assessment:** `main.ts`, `style.css`, complete editor/lifecycle integration.
- **root:** package/config, README/CI/catalog, browser verification/integration and shipping.
- **git_runner:** production-browser acceptance/review tests; coordinates fixtures and package test entries with root, without changing others' implementation files.

Freeze these signatures before dispatch. Any necessary change is explicitly communicated to root and all consumers; do not create competing public shapes. Root owns Git commits and conflict resolution. Owners verify their files; a fresh reviewer checks integration and real browser results.

## Acceptance and stopping point

Verify empty-profile startup → user pieces/examples → trained assessment → occasion/mode alternatives → editable saved look → correction of its rating → PNG/JSON exports → reload → validated import → undo/redo. Test cold start without claiming personalization; no eligible occasion; diversity fallback; category/example/photo/serialized/history quotas; snapshot survival after piece edits/deletion; asset GC; corrected labels; malformed JSON/JPEG and deep inputs; stale async photo/load/import/export; ordered save failure/recovery; storage unavailable; accessible desktop/mobile navigation. Real production Chromium must decode normalized JPEGs and exported boards. Pin classifier tests to deterministic finite results and held-out synthetic preference patterns, not training-set memorization alone. Add a test showing equal user inputs do not produce a secret fixed-rule score and changing actual ratings changes learned predictions.

Once this complete local preference-to-look flow passes review, place the app in maintenance. Automatic image understanding, calibrated preference evaluation, broader browser/device tests, shopping catalogs, pretrained embeddings and online sharing are future work, not reasons for endless polishing of the first milestone.
