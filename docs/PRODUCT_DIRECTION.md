# Product direction — 2026-10-08

This document records the owner's revised product direction following a review of all seventeen project ideas. It defines destinations and acceptance expectations, not delivered functionality or an approved technical implementation plan. Read it alongside `PROJECT_IDEAS.md` and each application's current implementation documentation.

This is the current product-direction source of truth. Where earlier descriptions, design plans, issue scopes, README limitations or milestone completion labels conflict with it, follow this direction and reconcile the older plan before continuing. Newer explicit owner instructions supersede this document. The owner subsequently requested branch consolidation: `main` is the canonical branch for all fourteen applications and this direction. Historical `Astra` and feature-branch snapshots are retained through archive tags; resume development from current `main` rather than reviving those parallel branches.

## Portfolio-wide development standard

Twelve implemented applications remain ACTIVE. Composure and Shot Studio are DEFERRED by the owner as of 2026-10-14; follow their holds below. The previous MAINTENANCE labels do not establish completion of the revised visions. The phone-restriction and handwriting projects retain their recorded BLOCKED status; paper trading remains explicitly skipped. ACTIVE identifies unfinished product development, not a requirement to develop every application concurrently.

A functioning prototype, bounded vertical slice, completed issue, passing test suite, or reliable storage/export workflow is an intermediate achievement. None alone establishes completion of the intended product. Historical acceptance receipts continue to describe the exact milestones they measured; they must not be presented as acceptance of these broader visions.

Continue developing the original visions for projects whose direction was not changed. Choose coherent next milestones that close meaningful user-facing gaps. Reliability and recovery remain necessary, but repeated supporting improvements must not replace progress on a project's defining capabilities. Evaluate usefulness, editing quality, creative control, accessibility, domain quality and real-use behavior where relevant, alongside technical correctness.

Existing input limits, local-only architectures, manual workflows and simplified representations are implementation choices to reassess as the product grows. They are not permanent limits on the vision. Design and verify changes deliberately; do not merely remove resource guards or relabel simulations as real capabilities.

MAINTENANCE is appropriate only when the intended product experience is substantially delivered and evaluated in relevant real use, with no major capability gap requiring active development. Do not narrow the vision to justify this status. Record remaining gaps and evidence before a future status transition. Existing prohibitions on paid charges and irreversible production changes remain in effect.

## 1. Gaze Navigator

Gaze Navigator helps people who have difficulty using a mouse or keyboard interact with websites through gaze and spoken instructions. A visible context circle indicates the area they are looking at. When they speak, the app captures that context, interprets their instruction with the rule baseline and optional on-device WaterSheep target matching, and performs the intended browser action. It provides accessible feedback, asks when the target is unclear, and supports immediate cancellation.

The core experience includes:

- Context selection: a stable gaze circle with visible feedback about the elements included.
- Spoken control: opening links, selecting controls, scrolling regions and navigating back.
- Text entry: dictating into a selected field and correcting text.
- Clarification and confirmation: resolving ambiguous targets and confirming consequential actions.
- Accessible recovery: spoken pause/cancel, adjustable timing and usable feedback when tracking or speech recognition fails.

Success means someone can complete useful tasks on real websites with manageable effort and few unintended actions. Evaluate task completion, effort, unintended actions, clarification and recovery with intended users and real tracking/speech input. The practice inbox, dwell controls and separate model lab are supporting prototypes, not the completion target.

Jev was the intended interpreter; on 2026-10-13 the owner replaced it with WaterSheep (see the owner update below). Its suitability and integration still require evidence. Browser integration, speech recognition, the exact instant context is captured, confirmation rules and supported platforms remain technical design questions. Preserve separate tracking, context, interpretation and execution responsibilities so failures and cancellation can be handled coherently.

### Owner update — 2026-10-14: browser extension as the primary product

After testing the practice website and discussing a standalone app versus a browser plugin, the owner chose the extension: “extension is the plan.” Make the browser extension the primary Gaze Navigator product. Continue from the existing Chrome Manifest V3 extension and shared navigation runtime. The intended experience is controlling the website the user is already visiting through gaze context and spoken instructions, with a compact contextual overlay and accessible pause/cancel/recovery controls.

Use the website for onboarding, guided practice, calibration instruction and demonstrations. Practice inboxes, synthetic decision labs and a separate browser tab are supporting tools; future milestones should prioritize a usable extension experience on real websites. Make installation, permission setup, camera/speech readiness and starting/stopping navigation understandable. Support deliberate continuity across page changes with clear calibration reuse/recalibration and permission boundaries; do not require users to reopen the practice site to operate each page.

Evaluate actual extension installation and use with intended users, real camera/microphone input and representative websites, including navigation, text entry/correction, ambiguity, consequential-action confirmation and immediate cancellation. Preserve the existing rule baseline, optional local WaterSheep matching, privacy boundaries and explicit control over website access. The extension implementation already exists; this direction does not claim that distribution, physical-input reliability or intended-user acceptance is complete.

A standalone desktop app for control outside the browser is a possible later direction, not the current delivery target or an instruction to begin an operating-system integration or migration. Scheduled Gaze work should follow this extension-first direction; Gaze Navigator remains ACTIVE and the broader accessibility goals remain unchanged.

### Delivery note — 2026-10-16 (#273)

The extension's shared runtime now supports spoken native-field select-all, cursor start/end and explicit insertion/replacement at the current selection, with exact text, caret placement and ordinary text Undo. It retains focused read-only identity for these new commands and refuses unsupported targets. Ordinary append dictation is unchanged. Source and canonical main CI pass 171 unit and 284 native browser cases; [the integration record](2026-10-16-gaze-selection-integration.md) preserves review fixes and the failed local portable-extension attempt. Gaze remains ACTIVE; physical speech/gaze and intended-user acceptance are unverified. The older ordinary-edit targeting defect has an implemented fix in #274; [its verification record](2026-10-16-gaze-writable-fields.md) records source checks and canonical verification status.

### Delivery note — 2026-10-17 (#275)

Native text fields now support spoken literal phrase selection and explicit repeated-occurrence choice, followed by existing exact correction and text Undo. The runtime refuses an ambiguous or absent phrase and rechecks actual focus through shadow/frame boundaries. Reviewed source CI passes 184 unit and 320 native browser cases; canonical main verification is pending. [The integration record](2026-10-17-gaze-phrase-selection.md) preserves review regressions, local/hosted gates and remaining physical-input limits. Gaze remains ACTIVE against the full extension-first destination.

## 3. Melody Studio

Melody Studio's destination is a respectable, full music-production DAW with the depth and creative control associated with tools such as FL Studio. Most of the original voice-to-music vision remains: users can capture hummed or sung ideas, review and edit notes, choose sounds, layer parts and use AI assistance while retaining musical control. The destination is not limited to a simple sketchbook.

Users should be able to develop ideas into complete, polished productions. The roadmap needs to address full-song arrangement, capable note and audio editing, instruments and sounds, mixing, effects, routing, automation, complete project management and useful exports. These are development areas implied by the DAW ambition; exact feature scope, plugin support, native/browser architecture and compatibility standards require subsequent design. Referencing FL Studio establishes the intended level of capability, not an instruction to copy its interface or promise feature parity.

Current short recording/composition limits and simple instruments describe the prototype. Preserve its working capture, transcription, reference comparison and editing foundations while designing a credible path beyond those limits. A short-continuation learner does not by itself fulfill broad arrangement assistance.

Success requires a musician to create, edit, arrange, mix and export a useful complete production with dependable sound and responsive control. Evaluate actual vocal capture, musical usefulness and end-to-end production, not only synthetic audio or persistence tests. Focused milestones remain intermediate achievements.

### Owner update — 2026-10-14: focused sections and contextual controls

The owner confirmed that Melody Studio, Motion Studio and Lens Studio all show too much information on one page. For Melody, make composing and listening understandable through focused sections and contextual panels/modals. Keep the arrangement/piano roll and essential playback controls prominent. Reveal note/track editing, recording, instruments/effects, references, project/library management, exports and detailed explanations in the relevant section or dialog instead of displaying every form at once. Exact navigation and grouping require design; this feedback does not prescribe a particular DAW layout or reduce the full-DAW destination.

Prioritize a coherent navigation and information-density milestone when resuming Melody work. A user should be able to load or capture an idea, edit it, listen and find an export without confronting unrelated settings. Preserve notes, audio, selection, raw drafts, Undo/Redo, recovery and deliberate playback behavior when switching sections or opening/closing dialogs. Check desktop and phone usability, discoverability and keyboard/modal focus, including clear close/back behavior. This records future work, not a delivered redesign; Melody remains ACTIVE.

### Delivery note — 2026-10-15 (#261)

The focused composing milestone now provides Compose, Capture, Sound, Notes, Arrange, Reference and Project & export sections plus an expanded workspace. Mounted controls and passive-navigation guards retain drafts and operation ownership; the toolbar exposes audio stop, save/recovery status and clear back behavior. Source verification passes428 unit and247 native browser tests, including desktop/phone creative flows, raw drafts and pending-operation races. See `docs/2026-10-15-melody-workspace-integration.md` for integration evidence and retained failures. This addresses the information-density milestone; intended-musician usability, broader production capability and the full DAW destination remain ACTIVE.

## 5. Clothing Studio

Clothing Studio is a professional garment-design application with the depth and creative control of tools like CLO. It enables users to develop clothing from an idea into an editable, three-dimensional garment, refine its construction and materials, evaluate it on a personalized body, and prepare it for presentation or physical production.

Users can begin with sketches, descriptions, reference images, existing patterns or garment templates. AI helps translate those inputs into editable designs and proposes changes, while users retain precise control over pattern pieces, measurements, seams, silhouettes, fabrics and construction details.

The core experience includes:

- Garment construction: real 2D pattern pieces linked to a 3D garment, including seams, darts, pleats, pockets, closures and layered construction.
- Realistic cloth simulation: fabric weight, stretch, stiffness and other material properties affecting drape, folds, movement and interaction with the body.
- Personalized fitting: adjustable or imported avatars, entered body measurements, multiple viewing angles and poses. Photo-assisted body creation exposes assumptions and allows correction.
- Design exploration: multiple garment categories, outfits and comparisons of cut, sizing, materials, colors and graphics.
- AI-assisted creation and refinement: structured, editable garment proposals from instructions and references, preserving design intent through deliberate review and revision.
- Professional workflows: organized projects, reusable assets, version history, reliable recovery, size grading, high-quality rendering and appropriate pattern, measurement, material and 3D exports.

The interface should make garment design approachable while providing precision and depth for increasingly sophisticated work.

Success means a user can develop an original garment, meaningfully refine its construction and simulated fit, and export useful results for further design, presentation or production validation. Evaluate visual appeal, editing quality, simulation credibility and practical usefulness alongside technical reliability. A simulation or exported pattern is not automatically validated for physical manufacture.

Development may proceed through focused milestones, but the destination remains a complete garment-design environment. A functioning prototype or single-garment workflow is not grounds for maintenance. The existing parametric T-shirt and photo overlay are current implementation foundations, not substitutes for linked patterns, 3D construction, simulation or fitting.

### Owner update — 2026-10-13

The owner asked to focus development on Gaze Navigator, Clothing Studio and Karaoke Studio. For Clothing Studio, the owner wants "something like" [Fabra](https://www.fabra.com/), an approachable web-based 3D product design tool:
- start from a library of base products and templates;
- style garment parts in real-time 3D with drag-and-drop materials, colors, prints and graphics;
- edit linked patterns;
- get an automatically generated tech pack, colorways and a range plan with costing.

This approachable loop is now the primary near-term experience. It is pursued alongside the professional depth described above, not instead of it. See [the branch research](https://github.com/twangyal/projects-monorepo/blob/d6f594a/apps/clothing-studio/docs/2026-10-13-fabra-research.md) for the research and roadmap.

For Gaze Navigator, the owner redirected the interpreter: "instead of jev look into [WaterSheep](https://github.com/SamratDuttaOfficial/WaterSheep)". WaterSheep is an open-source (Apache-2.0), locally runnable, calibrated decision model with Jev-compatible requests. It replaces Jev as the intended interpreter for target choice. The requirement for evidence is unchanged: it must be measured against the rule baseline for correct targets, unintended actions, abstention and latency before it drives real pages. See [WaterSheep research and retained evaluations](../apps/gaze-navigator/docs/2026-10-13-watersheep.md).

### Owner update — 2026-10-14: 3D-first workspace and contextual options

After trying Clothing Studio, the owner reported the same information overload as in Style Studio: too many options and explanations are displayed on one page. The requested direction is to make the editable 3D garment construction the main screen and use focused sections and modals to expose options and information when needed.

The next Clothing Studio experience should:

- **Center the 3D garment.** Make construction, viewing and direct part selection the primary workspace, readily visible on entry. Keep essential navigation and common actions close to the garment. Template selection should lead naturally into this workspace rather than requiring users to navigate a long page of unrelated forms.
- **Organize tools into focused sections.** Group garment/templates, materials and prints, artwork, pattern/measurements, body/drape, and presentation/exports into discoverable sections. Reveal the relevant controls for the active task or selected part instead of displaying every editor, table and explanation at once. Exact navigation and section boundaries require subsequent design.
- **Use contextual panels and modals.** Use appropriate panels or accessible dialogs for option libraries, detailed settings, help, tech packs, costing and other secondary information. Preserve the visible garment context where useful. Support clear close/back behavior, keyboard focus and mobile use; opening, switching or dismissing a section must preserve the design and handle unapplied drafts deliberately. Existing capabilities remain available through this organization.
- **Investigate AI assistance for “Describe a style.”** The owner suggested AI at the prompt shown in their screenshot. The concrete example is “navy vertical stripes”: the current response understands stripe and navy but reports “Not understood: vertical.” Explore richer natural-language interpretation that preserves attributes such as stripe direction, color, scale, material and the intended garment part. Treat this as a promising option to evaluate, not an already selected model/provider or delivered feature. The existing local parser remains the current implementation.

Any AI proposal should map to supported, editable garment properties, make its interpretation and part-versus-whole-garment scope inspectable, and allow deliberate application, correction and Undo. Unsupported details must remain visible rather than being silently dropped; if direction such as vertical stripes also needs new rendering controls, address that capability explicitly rather than merely claiming the prompt was understood. Evaluate representative descriptions for intent fidelity and visible garment results. Verify model feasibility, privacy and cost before integration; this request does not authorize paid services. AI research must not block the requested workspace redesign.

Success means a user can enter the app, focus on the 3D garment, find a relevant styling or construction option, see its effect and return to an uncluttered workspace without scrolling through every feature. Evaluate discovery, screen density, task completion and editing effort on desktop and phone, plus modal accessibility and preservation of existing projects and drafts. The broader professional construction, simulation and fitting vision remains in force.

Scheduled development should read this update before selecting or resuming Clothing Studio work and prioritize a coherent 3D-first interaction flow over adding more controls to the existing all-in-one page. This records requested future work; neither the workspace redesign nor AI integration is complete, and Clothing Studio remains ACTIVE. Other projects' direction and the existing portfolio focus are unchanged.

### Owner follow-up — 2026-10-14: material-dependent cloth physics

Draping a garment over a body/model must involve cloth physics, with different materials producing meaningfully different behavior. Changing a fabric must affect how the garment hangs, folds, stretches and contacts the body, as well as its visible texture. This is part of the intended 3D garment experience and should remain prominent in the revised workspace.

Research is an explicit part of this milestone. Investigate suitable simulation methods and credible material data, including fabric mass per area, directional stretch and shear, bending stiffness, damping, thickness and contact friction. Examine the effects of garment construction, seams, body shape, gravity, body contact and cloth self-collision and contact between layers. Fabric names alone do not establish physical properties: document parameter sources, units, calibration methods and assumptions, and distinguish measured values from approximate presets. Choose implementation milestones based on that research and the existing solver rather than prescribing an unverified physics engine.

The current XPBD top-drape implementation already uses gravity, stretch, bending and body friction, with approximate relative fabric settings and a chest-based body proxy. It is a foundation, not evidence of calibrated material behavior or realistic personalized fit. Research and development should address those limitations, including layered garments, body/contact fidelity and extension beyond the currently supported draped garments, without relabeling the existing approximation as physically validated.

Evaluate representative fabrics on the same garment and body so observed differences can be attributed to materials; compare with credible reference drapes or physical samples where available. Check fold/strain behavior, stretching along different fabric directions, contact and penetration, settling stability, and useful interaction/performance on supported devices. Keep limitations visible and make failed or unstable simulations understandable. Appearance alone does not validate physical fit or manufacturing readiness. Scheduled Clothing Studio work should include this research and validation alongside the 3D-first redesign; this follow-up records future requirements and does not claim that they are delivered.

### Material-law foundation delivered — 2026-10-15 (#266)

Body & drape now includes an independent static tensile comparison with two illustrative directional profiles, explicit SI mass/energy/force response,8/16-element checks, captured numerical JSON and owned cancellation. Material extensional coefficient and coupon force/extension stiffness are distinguished. Local and source/main CI pass121 units and146 native browser cases with project checks; see `docs/2026-10-15-clothing-tensile-integration.md`. The current garment solver stays unchanged. This axial foundation does not deliver membrane shear, bending/contact, calibrated materials or physical fit; the above research gates and ACTIVE destination remain in force.

### Bending-law foundation delivered — 2026-10-15 (#267)

Body & drape also offers an independent static cantilever comparison with two illustrative directional bending profiles, dimensioned D/EI, cubic curves, signed support reactions, explicit magnitudes, numerical JSON and owned cancellation. Local and source/main CI pass127 units and151 native browser cases with project checks. See `docs/2026-10-15-clothing-bending-integration.md`. This beam experiment supplies a controlled bending foundation alongside266; membrane shear/coupling, nonlinear garment dynamics/contact and measured-material/physical-fit validation remain unfinished. Existing garment drape and the full ACTIVE destination remain unchanged.

### Coupled membrane foundation — 2026-10-16 (#268)

Body & drape now includes a static orthotropic membrane comparison with directional stretch, transverse coupling and engineering shear,0/45/90degree grain and inspectable triangle meshes/numerical JSON. Coefficients are illustrative, and the affine traction patch checks assembly rather than general mesh convergence. Local and final source/main CI pass134 units and156 native browser cases with project checks. See `docs/2026-10-16-clothing-membrane-integration.md` for first failures, native-save barrier repair and deferred unloaded interior-mesh overlay. The current garment solver is unchanged; nonlinear/dynamic shell behavior, contact, measured-material and physical-fit validation remain unfinished. Clothing stays ACTIVE.

### Entered top torso girths — 2026-10-16 (#269)

The top-body proxy now accepts independent optional waist/hip girths while blank fields preserve its original chest-derived proportions. Session-only settings reach actual drape geometry/cache identity and captured exports, with atomic validation, retained raw drafts and stale-result protection. Extreme mismatches now report excessive numerical edge extension separately from residual motion. See `docs/2026-10-16-clothing-top-body-integration.md` for boundary measurements, retained failures, review and final gates. Final local and source/main CI pass137 units and161 native browser cases with project checks. This improves the entered-body experience without establishing anatomical accuracy or physical fit; body heights/depth/limbs and XPBD materials/contact remain approximations. Persistent personalized avatars and calibrated garment physics remain unfinished, and Clothing stays ACTIVE.

### Matched garment fabric comparison — 2026-10-16 (#270)

Body & drape can now compare two library fabrics on the same captured top/body with actual worker solves, matched front/back garment views and complete numerical receipts. Comparing preserves the current design; an explicit changed choice applies non-rib materials as one undoable edit, preserving rib trims, colors, prints, artwork and saved colorways. Already-used choices are disabled, and each new run adopts the current committed capture. Raw draft, worker/render retirement, retry and pending-image/import paths are covered. See `docs/2026-10-16-clothing-fabric-comparison-integration.md` for review, first failures and final gates. Final local and source/main CI pass 140 units and 172 native browser cases with project checks. This is controlled design exploration with the existing approximate solver, not integration of the independent swatch laws or physical fabric/fit calibration. Clothing remains ACTIVE.

## 6. Karaoke Studio

Karaoke Studio should make the song-to-karaoke process as automatic as possible. After upload, the application separates vocals and backing, automatically transcribes the sung lyrics, synchronizes them with the music, and produces a usable preview with export available. Users can correct words, line breaks and timing mistakes.

Manual editing is the correction workflow. Users should ordinarily receive a usable result without supplying all lyrics or timing each line themselves. Existing waveform, SRT, cue editing and practice controls support reviewing and refining automatic results. Uncertain passages need understandable feedback and efficient correction; corrected text and timing must be preserved.

Automatic transcription and alignment are central unfinished capabilities. Evaluate real-song transcription, synchronization and separation quality, plus the effort needed to correct results. Processing success and valid exported media alone do not establish a useful automatic karaoke experience. Model choices, supported material and acceptable quality thresholds remain to be designed and measured.

This lyric-automation clarification applies to project 6, Karaoke Studio. Melody Studio retains the full-DAW direction above.


### Automatic review timing correction — 2026-10-16 (#271)

Karaoke's automatic review now stages corrected words and start/end seconds together, supports native playhead marks, and auditions the edited interval before a deliberate one-step Apply. Original recognition remains visible and unchanged; all hidden lines must validate, Cancel preserves the editor, and Save remains separate. Timing edits retire owned playback and late native play results. See `docs/2026-10-16-karaoke-review-timing-integration.md` for review, retained local failures and final software gates. Final source/main CI pass 206 Python, 131 TypeScript and 114 browser cases plus project checks; local browser verification passes 114 cases, with the local Python failure retained in that receipt. This improves the correction workflow; real-song alignment quality, physical latency and intended-user correction effort remain unverified in #241. Karaoke stays ACTIVE.


### Whole-clip synchronization correction — 2026-10-16 (#272)

Karaoke's cue editor now shifts every line by one explicit signed-seconds offset as a single unsaved Undo/Redo edit, preserving literal words, lengths, gaps, title and pasted drafts. Complete invalid or out-of-clip proposals refuse without clipping or retiring active work; a successful shift retires obsolete playback/import/timing work. Save and current exports remain separate. See `docs/2026-10-16-karaoke-timing-shift-integration.md` for review, first failures and final gates. Final local browser117/117 and TypeScript134/project checks pass; final source/main CI passes206 Python,134 TypeScript and117 browser cases plus project checks. The preceding local Python/Ruff limitations remain recorded. This is manual bulk correction, not delay detection or real-song alignment/effort acceptance. Karaoke remains ACTIVE.

## 7. Shot Studio

### Owner update — 2026-10-14: deferred

The owner asked to defer Shot Studio after reviewing the available apps. Set its status to DEFERRED and exclude it from scheduled/autonomous development until the owner explicitly resumes it. Do not choose browser polish, new features, export investigations or a replacement platform as an automatic continuation of this project. No replacement platform has been selected.

Preserve the virtual-filmmaking vision, current source, tests, research, historical acceptance evidence and known unresolved export/headset limits for possible future use. Deferral does not establish completion or direct deletion or shutdown of the hosted test copy. Other projects retain their own direction and priorities.

## 9. Duet

Spotify integration and an automatically maintained shared musical timeline are the main points of Duet. The app turns a couple's listening activity into a musical history of their relationship.

Notable listening activity automatically creates timeline entries, including both people listening to the same song, a newly heard song and a new favorite. These entries do not require an approval step before appearing. Users can manually add entries and edit or remove automatic entries. They can attach text memories and photos to songs and revisit those associations through the timeline.

Timeline design must handle repeated observations and grouping so activity stays understandable. User edits and removal need durable behavior rather than being overwritten by repeated ingestion. Define what counts as shared, new and favorite, distinguish observed activity from inferred significance, and make those definitions understandable. Do not assume the two people listened simultaneously merely because they heard the same song.

Verify Spotify's available APIs, access requirements, permissions, history coverage and policies before selecting an integration design. No provider capability is established by this vision. Authentication, shared-history consent, private photos and listening-data handling require deliberate design.

Shared recommendations, occasion playlists and listening together support the Spotify/timeline experience. Existing uploaded-audio rooms and dated text memories are foundations, not fulfillment of the central integration and automatically populated timeline.

Success means meaningful events appear from real listening activity with little effort, users can correct and curate their history, and song-linked text/photo memories remain easy to revisit. Test actual integration and timeline relevance as well as reliable storage.

## 11. Motion Studio

### Owner update — 2026-10-14: focused sections and contextual controls

The owner confirmed the same crowded-page feedback for Motion Studio: use sections and modals to expose options and information more efficiently. Keep the artwork stage, timeline and essential drawing/playback actions prominent. Organize layer/exposure editing, pose/keyframe tools, stroke details, in-between reviews, project management, sharing and exports into focused sections or contextual panels/dialogs instead of one long page of controls. Use the selected artwork and task to reveal relevant options; exact grouping and navigation require subsequent design.

Prioritize a usable draw-to-animation interaction flow when resuming Motion work. A user should be able to start or open artwork, draw, set movement, preview and find an export without reading every advanced feature. Preserve artwork, images, cels, poses, selection, pending drafts/gestures, history and recovery across navigation; opening or closing a dialog must not silently commit or discard edits. Check desktop/phone discovery, screen density, keyboard focus and clear close/back behavior. Retain the broader authored-animation and useful AI-assistance vision; this update records future work and Motion remains ACTIVE.

### Focused workspace milestone delivered (2026-10-15, #263)

Motion now opens around the artwork stage with contextual Draw, Layers, Poses, Drawings, Projects, Share, Export and Help sections and a real expanded workspace. Mounted raw fields, selection, history, reviewed in-betweens and owned work survive navigation; Back/Escape, playback stop and export cancellation stay reachable. Final-source CI passes 273 units and 197 native browser cases, including desktop/phone authoring and decoded exports. See `docs/2026-10-15-motion-workspace-integration.md` for integrated evidence, retained first failures and the portable-browser maximum-export limit. This addresses information density; useful learned assistance, live synchronization and intended-person evaluation remain ACTIVE.

## 12. Style Studio

### Owner update — 2026-10-14: guided, visual onboarding

After trying Style Studio, the owner reported that the first screen contains too much information and that the app asks for too much manual entry. The requested direction is a screen-by-screen experience with picture-based preference choices at the beginning, similar to choosing favorite genres and artists during Spotify onboarding. Pinterest was suggested as a possible source of inspiration, alongside ready-made examples users can choose from.

Style Studio remains a personal style assistant for matching existing taste, exploring a new style and dressing for an occasion. The next Style Studio milestone should make that experience approachable from the first visit. Existing wardrobe, feedback, saved-look and wear-history capabilities are foundations to reorganize around this flow.

The revised experience should:

- **Present one focused screen at a time.** Guide users through getting started, choosing visual preferences and reaching suggestions. Show only the information and controls relevant to the current step, with clear next/back navigation and preserved choices. Returning users should reach their looks or wardrobe without repeating onboarding. Detailed explanations, profile management, exports and advanced controls should be available when needed rather than filling the opening screen.
- **Learn taste through pictures.** Begin with a manageable selection of outfit/style images that users can select, like, pass on or skip. Use the Spotify reference for the ease of choosing visual examples; exact screen counts, selection thresholds and interface details require subsequent design. Let users revisit and refine their choices. Show recognizable clothing and outfit imagery, rather than making abstract tags or long forms the primary way to express taste.
- **Reduce required typing and setup.** Do not require users to name and tag a wardrobe, understand the model or enter every preference before receiving a useful first result. Use supplied examples and sensible, editable defaults to make first-use exploration possible. Add personal wardrobe pieces progressively when useful; keep detailed tags, notes and other optional information out of the critical path. Distinguish example outfits from clothes the user actually owns, and sample preferences from their explicit choices.
- **Investigate Pinterest or a comparable visual source.** Assess whether a supported integration can let users select inspiration or bring in their own references. Verify actual API access, permissions, image-use rights, privacy and any costs before choosing an implementation. Pinterest is an option to evaluate, not an established capability or a mandatory dependency. A curated, appropriately licensed image collection should provide a useful onboarding path without a third-party account; unavailable integration must not block the guided visual experience.
- **Turn choices into useful suggestions.** Visual selections must inform the user's retained preferences and subsequent results, rather than acting as a decorative tour. Explain results briefly and offer simple feedback to refine them. Keep early results honest about limited preference evidence and whether they use examples or the user's wardrobe; do not claim automatic clothing recognition or calibrated recommendation quality without evidence.

Success means a new user can understand what to do, choose pictured examples and reach relevant-looking suggestions with little typing and without confronting every form at once. Evaluate the complete first-use journey on desktop and phone, including screen clarity, required input, time/effort to the first useful result, back/skip behavior, retained choices and recommendation usefulness. Passing existing storage or model tests alone does not establish that this usability problem is resolved.

Scheduled development should read this update before selecting or resuming Style Studio work, reconcile older plans with it, and prioritize a coherent visual-onboarding-to-suggestions milestone over adding more fields or polishing the current all-in-one page. Preserve existing user profiles and useful functionality as the interface changes. This update records requested future work; the current application has not yet been redesigned and Style Studio remains ACTIVE. Other projects' direction and the existing portfolio focus remain in force.

### Guided visual milestone delivered — 2026-10-15 (#264)

Style now offers a no-typing pictured-choice → example-inspiration path, with twelve original outfit illustrations, explicit correctable votes and no inserted owned clothes or supplied personal preferences. Sparse tag matching and the existing sufficiently trained model are distinguished, including visible sample-label provenance. Focused screens, More tools and a real expanded view retain raw editor/history/operation owners; keyboard and restore-time navigation preserve deliberate choices. Final-source CI passes 64 units and 78 native browser cases. See `docs/2026-10-15-style-onboarding-integration.md` for integrated evidence, source research and retained failures. This addresses first-use information density and a first source of visual taste evidence; intended-user usefulness and the broader style-assistant goals remain ACTIVE.

Milestone #265 continues that path into owned clothing: explicit top/bottom/shoes starters, visible editable defaults, optional actual photos, category progress and current-choice combinations reach saved looks and PNG/JSON/reload without typing. Draft/photo protection and piece-level discard preserve saved clothing. Source and integrated-main CI pass67 units and84 native cases with lint/types/build; see `docs/2026-10-15-style-quick-wardrobe-integration.md`. Declared defaults are not recognition, and software checks do not establish real-user taste relevance or fit. Style remains ACTIVE.

## 13. Stock Notebook

Retain the original stock-research vision: turn a broad investing idea into visible screening criteria and an understandable, source-linked research summary, distinguishing supplied facts, derived observations and generated claims.

Use AI-model API calls to interpret users' natural-language screening requests. This requirement is specifically about interpretation; it is not a new requirement to purchase financial-data APIs or to use a model for generated investment analysis. Those are separate product and sourcing questions.

Show the proposed interpretation as editable criteria, resolve ambiguity and unsupported requests, and require deliberate application before changing the screen. Model responses must map to validated supported operations; invented financial facts or silently changed constraints are not acceptable interpretations. Keep supplied data and existing manual/controlled-language tools usable when model access is unavailable.

Use genuinely free model access if a suitable option is available. Verify pricing, quotas, data handling and overage behavior before choosing a provider; do not assume a free tier prevents charges. Paid AI-model API integration is deferred unless the owner later authorizes spending. If no suitable no-cost service is available, document that specific dependency and continue independent product work without claiming the interpretation milestone is complete.

Success for this milestone means varied ordinary requests produce correct, inspectable screening criteria, uncertainty is handled usefully, and failure preserves the user's current work. Measure interpretation quality on representative requests rather than accepting any syntactically valid response. The earlier failed local paraphrase experiment remains evidence about that experiment; it does not replace the new API-based direction.

## 16. Lens Studio

### Owner update — 2026-10-14: focused sections and contextual controls

The owner confirmed the same crowded-page feedback for Lens Studio: use focused sections and modals so the photo experiment is understandable without displaying every option and explanation at once. Keep the source/result comparison and essential framing controls prominent. Organize photo/project opening, focal/perspective settings, depth painting/selection or estimation, mask exchange, recovery/exports and detailed simulation information into discoverable sections and contextual panels/dialogs. Keep information needed to interpret a result available at the point of use. Exact grouping and navigation require subsequent design.

Prioritize a coherent import-to-comparison flow when resuming Lens work. A user should be able to open a photo or demo, change framing or perspective, compare the result and find an export without confronting unrelated forms. Preserve source pixels, depth masks, applied settings, raw drafts, selection/history and recovery when navigating. Retain ownership/cancellation of pending image/model/render work so dismissed or superseded operations cannot apply later unexpectedly. Check desktop/phone discovery, keyboard/modal focus and clear close/back behavior. The original photo-simulation and depth/reconstruction goals remain in force; this records future work and Lens remains ACTIVE.

### Delivery note — 2026-10-15 (#262)

Lens now opens into a focused photo flow with Compare, Open, Depth, Mask exchange, Project & export and Help sections, plus a real expanded workspace. Navigation retains mounted raw fields, proposals/history and owned work; global cancellation/recovery and a direct phone framing shortcut remain reachable. Final source CI passes95 units and102 native browser cases. See `docs/2026-10-15-lens-workspace-integration.md` for integrated evidence, local baseline failures and verification-process limitations. This addresses the information-density milestone; intended-person usefulness and broader depth/reconstruction remain ACTIVE.

## 17. Composure

### Owner update — 2026-10-14: deferred pending platform reconsideration

After trying the browser app, the owner said Composure does not work as a browser app and asked to defer it. Composure is now DEFERRED. This is the owner's assessment of the product/platform experience, not a newly diagnosed technical failure or a claim that its earlier automated checks failed.

Exclude Composure from scheduled and autonomous development until the owner explicitly resumes it. Do not select browser polishing, new features, additional acceptance work or a platform migration as a way to continue this deferred project. The earlier goal of a heart-rate-driven horror game remains recorded, but a suitable platform and experience must be reconsidered before resumption; no native, desktop, mobile or game-engine replacement has been selected.

Retain the existing source, tests, research and historical acceptance evidence for possible future use. Deferral is not completion, maintenance acceptance, deletion or an instruction to disable the hosted test copy. Other projects' direction and priorities remain unchanged.
