# Product direction

Last revised 2026-10-25. This is the source of truth for what each project should become. Where an older plan, issue, README or commit message conflicts with it, follow this document. A newer explicit instruction from the owner overrides it.

It records destinations and owner decisions, not delivery logs. What has shipped is visible in the code, tests and git history.

## Portfolio focus (owner instruction, 2026-10-25)

Development is concentrated on three projects:

1. **Gaze Navigator** (`apps/gaze-navigator`)
2. **Clothing Studio** (`apps/clothing-studio`)
3. **Karaoke Studio** (`apps/karaoke-studio`)

These are the only `ACTIVE` projects. Every other implemented app is `DEFERRED`: excluded from scheduled and autonomous work until the owner explicitly resumes it. This repeats and strengthens the owner's 2026-10-13 request to focus on these three. Deferral is not deletion or completion; deferred apps keep their source, tests and CI and must stay in a working state.

The phone-restriction and handwriting projects stay `BLOCKED`. Paper trading stays skipped.

## Development standard

- **Build the defining experience.** Each priority app has one core loop (below). Prefer milestones that make that loop work end to end for a real user over adding another narrow control, edge case or verification layer to a loop that does not yet work.
- **Prototype limits are not the vision.** Input caps, local-only storage, manual workflows and simplified models are current implementation choices. Change them deliberately; do not relabel a simulation as a real capability.
- **Quality is part of delivery.** Accessibility, correctness and data safety still matter. Do not weaken safety or hide failures to claim progress.
- **Status is honest.** `MAINTENANCE` or `DONE` requires the intended experience to be delivered and tried in real use. A passing test suite or a completed issue is an intermediate milestone.
- **Standing safety rules:** no paid services or charges without owner approval, no irreversible production changes, no committed credentials.

---

## 1. Gaze Navigator — ACTIVE (priority)

**Vision.** Help people who have difficulty using a mouse or keyboard operate real websites with gaze and speech. A visible context circle shows where they are looking. When they speak, the app captures that context, interprets the instruction (rule baseline plus optional on-device WaterSheep target matching) and performs the browser action, with accessible feedback, clarification when the target is unclear, confirmation of consequential actions and immediate spoken pause/cancel.

**Core loop:** look at something → say what to do → the right thing happens on the page (or the app asks).

Core capabilities: opening links and selecting controls, scrolling regions, back navigation, dictation and text correction, clarification and confirmation, and accessible recovery when tracking or speech fails.

**Owner decisions**
- *2026-10-13:* Use [WaterSheep](https://github.com/SamratDuttaOfficial/WaterSheep) (Apache-2.0, locally runnable) instead of Jev as the target-choice interpreter. It must be measured against the rule baseline (correct targets, unintended actions, abstention, latency) before it drives real pages.
- *2026-10-14:* **The Chrome (Manifest V3) browser extension is the primary product.** Control the site the user is already on through a compact overlay with pause/cancel/recovery. The website is for onboarding, practice, calibration help and demos. Make installation, permissions, camera/speech readiness and start/stop understandable, and keep calibration across page changes. A standalone desktop app is a possible later direction, not current scope.

**Success** means someone can finish useful tasks on real websites with manageable effort and few unintended actions. Evaluate with intended users, real camera and microphone input and representative sites.

**Biggest gap.** The extension supports a wide range of native form controls in software, but the real end-to-end loop (physical gaze tracking plus real speech on real sites) has not been evaluated with intended users. Prioritize making that loop dependable over adding further control types.

**Next (updated 2026-10-27):** with simulated webcam error (120 px), scripted real-site tasks complete about 90% of the time with no unintended actions; named controls outside the gaze circle are reached directly when just outside it and offered for confirmation when farther. Remaining misses are topic paraphrases ("the stuff about cars") that need the optional model, and scroll regions far from the gaze. The next step is evaluation with a real webcam, a real microphone and intended users on representative sites.

---

## 2. Clothing Studio — ACTIVE (priority)

**Vision.** A professional garment-design environment with the depth of tools like CLO, made approachable. Users go from sketches, descriptions, references, patterns or templates to an editable 3D garment. Real 2D pattern pieces link to 3D construction with seams, darts, pleats, pockets, closures and layers. Credible material simulation drives drape, folds and fit on adjustable or personalized avatars. AI proposes structured, editable designs under user control. Multiple categories, outfits, grading, reusable assets, version history, rendering and pattern/measurement/material/3D exports support design, presentation and production validation.

**Core loop:** pick or describe a garment → shape and style it in 3D → see it drape on a body → export it.

**Owner decisions**
- *2026-10-13:* The near-term experience should feel like [Fabra](https://www.fabra.com/): start from base products and templates, style parts in real-time 3D with drag-and-drop materials, colors, prints and graphics, edit linked patterns, and get an automatic tech pack, colorways and a costed range plan. This runs alongside the professional depth above, not instead of it.
- *2026-10-14 (workspace):* Too many controls on one page. Make the **editable 3D garment the main screen**. Group tools into focused sections (garment/templates, materials and prints, artwork, pattern and measurements, body and drape, presentation and exports) with contextual panels and accessible dialogs. Opening, switching or closing a section must preserve the design and handle unapplied drafts deliberately. Works on desktop and phone.
- *2026-10-14 (AI):* Investigate AI for "Describe a style". Example: "navy vertical stripes" currently reports "Not understood: vertical". Interpretations must map to supported, editable properties, show their scope (part or whole garment), and allow apply, correct and Undo. Unsupported details stay visible. Verify feasibility, privacy and cost first; no paid services without approval. AI research must not block the workspace work.
- *AI style interpretation: outcome (2026-10-27).* Small local models that could run in the browser were tried for rewriting free-form descriptions into the app's vocabulary: Qwen2.5-Instruct 0.5B and 1.5B (Apache-2.0, int8 ONNX through transformers.js), prompted with the vocabulary and examples. Neither followed it; both invented garments and accessories ("black leather jacket", "thigh-high boots"), and the 1.5B model needs a 1.6 GB download and about 11 s per description on a CPU. Not adopted. Instead the deterministic parser gained about 600 everyday colour names from the xkcd colour survey (CC0). A hosted model would need owner approval for cost and privacy.
- *2026-10-14 (physics):* Draping must use real cloth physics, and **different materials must behave meaningfully differently** (hang, folds, stretch, body contact), not just look different. Research simulation methods and credible fabric data (mass per area, directional stretch and shear, bending, damping, thickness, friction), document sources and units, and validate against reference drapes where possible. The current XPBD drape is a foundation, not calibrated physics.
- *2026-10-17:* Investigate [PPF Contact Solver](https://github.com/st-tech/ppf-contact-solver) as a possible higher-quality native backend.

**PPF solver research: outcome (2026-10-17 to 2026-10-21).** A pinned native CPU build of PPF ran in CI. Static-plane and convex-sphere contact worked (zero penetrations with contact on, many with it off). Normalized stretch and bending parameters responded as expected. A captured tee garment was bridged into the solver, and peak underarm strain of about 41% (soft) and 26% (stiff) was traced to the garment's construction geometry rather than the solver. The native build takes about 7 minutes, the solver cannot run in the browser, and a 3-second garment pair timed out at 300 seconds on a single-core runner. **No engine was adopted; the shipping app uses its own XPBD solver.** On 2026-10-25 the full study (scripts, about 200 MB of result archives and 18 CI workflows) was removed from `main`. It is preserved on the `archive/pre-cleanup-2026-10-25` branch under `docs/research/ppf-cpu`. Resume it only on a new owner instruction.

**Success** means a user can design an original garment, refine its construction and simulated fit, and export useful results. Judge visual appeal, editing quality, simulation credibility and usefulness alongside reliability. A simulation or exported pattern is not automatically validated for manufacture.

**Biggest gaps:** material-dependent drape that is visibly convincing in the browser across garments (the body is a proxy), AI style interpretation beyond the local keyword vocabulary, layered garments and personalized bodies.

**Next (updated 2026-10-27):** unify the three garment systems (concept tee, product bases, skirt construction) on the product-base system: they now share one solver and one fabric library, but still have two body models. Fabrics now differ through approximate physical bending and stretch properties, and stretch now depends on direction to the grain, but the roughly 2 cm mesh cannot form soft-knit folds, the model is elastic (no creep), and nothing is compared with reference drapes; a finer simulation mesh and a cantilever or drape-test comparison are the next physics steps. Every product base and the legacy skirt dialog drape with the same solver, and every garment is now sewn from its own pattern pieces (tops with set-in sleeves), but the hood is still modelled rather than sewn, the patterns are simplified finished shapes, and there is no cloth-to-cloth contact for layers.

---

## 3. Karaoke Studio — ACTIVE (priority)

**Vision.** Make song-to-karaoke as automatic as possible. Upload a song; the app separates vocals and backing, transcribes the sung lyrics, synchronizes them with the music and produces a preview ready to export. Users correct words, line breaks and timing when mistakes occur.

**Core loop:** upload a song → get a usable synced karaoke track without typing lyrics → fix the few mistakes → export.

Manual editing is the *correction* workflow. Supplying all lyrics and timing each line by hand must not be the normal path. Uncertain passages need understandable feedback and efficient correction. Corrected text and timing must be preserved.

**Success** includes real-song separation, transcription and alignment quality and low correction effort, alongside reliable exports. Measure these on real songs; a successful export alone does not prove a useful automatic experience.

**Biggest gaps:** automatic lyrics are not yet good enough to be the normal path (a developer benchmark on JamendoLyrics English songs found about 31% word error), so users still end up pasting lyrics. Multilingual coverage is partial (European languages, where the optional Whisper model cut word error to 15-35% in Spanish, German and French, plus Chinese, Japanese and Korean, where Japanese and Korean recognition is rough), and correction effort has not been measured with real users.

**Fix first (review, 2026-10-25):** look up existing lyrics (for example LRCLIB) and align them instead of relying on recognition text; replace the word-alignment step, which silently returns no matches above about one million word pairs (long or dense songs); keep finished stems when the user cancels recognition; include `transcript.json` in backups and show why recognition failed; and add a CI job that runs the real models on one short song. Stop adding manual-editing micro-features until correction effort has been measured.

---

## Deferred projects

All are `DEFERRED` as of 2026-10-25 unless noted. Do not resume them, choose platform migrations for them or run investigations on them without a new owner instruction. When one is resumed, start from the direction below.

### Melody Studio (`apps/melody-studio`)
Destination: a full music-production DAW with the creative depth of tools like FL Studio, keeping the voice-to-music idea (capture hummed or sung ideas, edit notes, choose sounds, layer parts, AI assistance with musical control). It needs full-song arrangement, note and audio editing, instruments, mixing, effects, routing, automation and exports.
- *Owner 2026-10-14:* Too much on one page. Keep the arrangement/piano roll and transport prominent; move other tools into focused sections and dialogs. A focused workspace shipped on 2026-10-15.
- *Note:* the long-running backed-recording clock-timing research (#300) produced research commits but no user-facing change. Do not restart it by default.

### Motion Studio (`apps/motion-studio`)
Destination: an account-free browser drawing and animation studio. Draw or import artwork, set keyframes, preview and export, with optional private-link saving and later AI help with in-betweens.
- *Owner 2026-10-14:* Too crowded. Keep the stage, timeline and essential actions prominent, with focused sections and dialogs. A stage-first workspace shipped on 2026-10-15.

### Duet (`apps/duet`)
Destination: Spotify integration and an automatically maintained shared musical timeline for a couple. Shared, new and favorite listening events appear without approval, users can curate them, and memories (text or photos) attach to songs. Verify Spotify API access and policies before designing the integration. Uploaded-audio rooms are a foundation, not the goal.

### Git History (`apps/git-history`)
Destination: a developer assistant that explains how and why code evolved by tracing lines and functions through commits, diffs, pull requests and discussions, separating documented reasoning from inference. It might become a browser extension.

### Style Studio (`apps/style-studio`)
Destination: a personal style assistant that learns taste from outfits a user likes, dislikes and wears, suggests combinations for occasions and explains them.
- *Owner 2026-10-14:* The first screen was overwhelming and required too much typing. Use guided screen-by-screen onboarding with picture-based taste choices (similar to Spotify's genre picks), fewer required fields and a quick path to suggestions. Evaluate Pinterest or a curated licensed image set. A guided onboarding milestone shipped on 2026-10-15.

### Friendly Challenges (`apps/friendly-challenges`)
Destination: a social app for friendly bets with favors and bragging rights (never money). Agree on terms, deadline and evidence; results feed a social record; disputes are voided or settled by a chosen third party.

### Lens Studio (`apps/lens-studio`)
Destination: a photo editor that simulates different lens and camera setups (field-of-view change, and focal length with camera distance for perspective change), with depth-aware reconstruction and honest presentation as a simulation.
- *Owner 2026-10-14:* Too crowded. Make it comparison-first with focused sections. This shipped on 2026-10-15.

### Stock Notebook (`apps/stock-notebook`)
Destination: turn a broad investing idea into visible, editable screening criteria and a source-linked research summary. Use AI-model API calls specifically to interpret natural-language screening requests into validated operations, with clarification and deliberate apply. Use free model access only; verify pricing and quotas first. Keep manual screening working without a model.

### Color Context Lab (`apps/color-context-lab`)
Destination: research whether color and surround changes can keep an artwork's appearance for people while disrupting how image models learn from it. It needs an artist-facing comparison UI and reproducible experiments, and must report measured effects honestly rather than promise protection.

### Shot Studio (`apps/shot-studio`): owner-deferred 2026-10-14
A virtual filmmaking studio (stage performers, light the set, operate cameras, record takes, assemble video, optional VR). Deferred after the owner's review. No replacement platform has been chosen.

### Composure (`apps/composure`): owner-deferred 2026-10-14
A heart-rate-driven horror escape game. The owner found it does not work as a browser app. The platform must be reconsidered before it resumes.
