# Product direction — 2026-10-08

This document records the owner's revised product direction following a review of all seventeen project ideas. It defines destinations and acceptance expectations, not delivered functionality or an approved technical implementation plan. Read it alongside `PROJECT_IDEAS.md` and each application's current implementation documentation.

## Portfolio-wide development standard

All fourteen implemented applications remain ACTIVE. The eleven previously marked MAINTENANCE have meaningful product development ahead of them. The phone-restriction and handwriting projects retain their recorded BLOCKED status; paper trading remains explicitly skipped. ACTIVE identifies unfinished product development, not a requirement to develop every application concurrently.

A functioning prototype, bounded vertical slice, completed issue, passing test suite, or reliable storage/export workflow is an intermediate achievement. None alone establishes completion of the intended product. Historical acceptance receipts continue to describe the exact milestones they measured; they must not be presented as acceptance of these broader visions.

Continue developing the original visions for projects whose direction was not changed. Choose coherent next milestones that close meaningful user-facing gaps. Reliability and recovery remain necessary, but repeated supporting improvements must not replace progress on a project's defining capabilities. Evaluate usefulness, editing quality, creative control, accessibility, domain quality and real-use behavior where relevant, alongside technical correctness.

Existing input limits, local-only architectures, manual workflows and simplified representations are implementation choices to reassess as the product grows. They are not permanent limits on the vision. Design and verify changes deliberately; do not merely remove resource guards or relabel simulations as real capabilities.

MAINTENANCE is appropriate only when the intended product experience is substantially delivered and evaluated in relevant real use, with no major capability gap requiring active development. Do not narrow the vision to justify this status. Record remaining gaps and evidence before a future status transition. Existing prohibitions on paid charges and irreversible production changes remain in effect.

## 1. Gaze Navigator

Gaze Navigator helps people who have difficulty using a mouse or keyboard interact with websites through gaze and spoken instructions. A visible context circle indicates the area they are looking at. When they speak, the app captures that context, interprets their instruction with Jev, and performs the intended browser action. It provides accessible feedback, asks when the target is unclear, and supports immediate cancellation.

The core experience includes:

- Context selection: a stable gaze circle with visible feedback about the elements included.
- Spoken control: opening links, selecting controls, scrolling regions and navigating back.
- Text entry: dictating into a selected field and correcting text.
- Clarification and confirmation: resolving ambiguous targets and confirming consequential actions.
- Accessible recovery: spoken pause/cancel, adjustable timing and usable feedback when tracking or speech recognition fails.

Success means someone can complete useful tasks on real websites with manageable effort and few unintended actions. Evaluate task completion, effort, unintended actions, clarification and recovery with intended users and real tracking/speech input. The practice inbox, dwell controls and separate model lab are supporting prototypes, not the completion target.

Jev is the intended interpreter. Its suitability and integration still require evidence. Browser integration, speech recognition, the exact instant context is captured, confirmation rules and supported platforms remain technical design questions. Preserve separate tracking, context, interpretation and execution responsibilities so failures and cancellation can be handled coherently.

## 3. Melody Studio

Melody Studio's destination is a respectable, full music-production DAW with the depth and creative control associated with tools such as FL Studio. Most of the original voice-to-music vision remains: users can capture hummed or sung ideas, review and edit notes, choose sounds, layer parts and use AI assistance while retaining musical control. The destination is not limited to a simple sketchbook.

Users should be able to develop ideas into complete, polished productions. The roadmap needs to address full-song arrangement, capable note and audio editing, instruments and sounds, mixing, effects, routing, automation, complete project management and useful exports. These are development areas implied by the DAW ambition; exact feature scope, plugin support, native/browser architecture and compatibility standards require subsequent design. Referencing FL Studio establishes the intended level of capability, not an instruction to copy its interface or promise feature parity.

Current short recording/composition limits and simple instruments describe the prototype. Preserve its working capture, transcription, reference comparison and editing foundations while designing a credible path beyond those limits. A short-continuation learner does not by itself fulfill broad arrangement assistance.

Success requires a musician to create, edit, arrange, mix and export a useful complete production with dependable sound and responsive control. Evaluate actual vocal capture, musical usefulness and end-to-end production, not only synthetic audio or persistence tests. Focused milestones remain intermediate achievements.

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

## 6. Karaoke Studio

Karaoke Studio should make the song-to-karaoke process as automatic as possible. After upload, the application separates vocals and backing, automatically transcribes the sung lyrics, synchronizes them with the music, and produces a usable preview with export available. Users can correct words, line breaks and timing mistakes.

Manual editing is the correction workflow. Users should ordinarily receive a usable result without supplying all lyrics or timing each line themselves. Existing waveform, SRT, cue editing and practice controls support reviewing and refining automatic results. Uncertain passages need understandable feedback and efficient correction; corrected text and timing must be preserved.

Automatic transcription and alignment are central unfinished capabilities. Evaluate real-song transcription, synchronization and separation quality, plus the effort needed to correct results. Processing success and valid exported media alone do not establish a useful automatic karaoke experience. Model choices, supported material and acceptable quality thresholds remain to be designed and measured.

This lyric-automation clarification applies to project 6, Karaoke Studio. Melody Studio retains the full-DAW direction above.

## 9. Duet

Spotify integration and an automatically maintained shared musical timeline are the main points of Duet. The app turns a couple's listening activity into a musical history of their relationship.

Notable listening activity automatically creates timeline entries, including both people listening to the same song, a newly heard song and a new favorite. These entries do not require an approval step before appearing. Users can manually add entries and edit or remove automatic entries. They can attach text memories and photos to songs and revisit those associations through the timeline.

Timeline design must handle repeated observations and grouping so activity stays understandable. User edits and removal need durable behavior rather than being overwritten by repeated ingestion. Define what counts as shared, new and favorite, distinguish observed activity from inferred significance, and make those definitions understandable. Do not assume the two people listened simultaneously merely because they heard the same song.

Verify Spotify's available APIs, access requirements, permissions, history coverage and policies before selecting an integration design. No provider capability is established by this vision. Authentication, shared-history consent, private photos and listening-data handling require deliberate design.

Shared recommendations, occasion playlists and listening together support the Spotify/timeline experience. Existing uploaded-audio rooms and dated text memories are foundations, not fulfillment of the central integration and automatically populated timeline.

Success means meaningful events appear from real listening activity with little effort, users can correct and curate their history, and song-linked text/photo memories remain easy to revisit. Test actual integration and timeline relevance as well as reliable storage.

## 13. Stock Notebook

Retain the original stock-research vision: turn a broad investing idea into visible screening criteria and an understandable, source-linked research summary, distinguishing supplied facts, derived observations and generated claims.

Use AI-model API calls to interpret users' natural-language screening requests. This requirement is specifically about interpretation; it is not a new requirement to purchase financial-data APIs or to use a model for generated investment analysis. Those are separate product and sourcing questions.

Show the proposed interpretation as editable criteria, resolve ambiguity and unsupported requests, and require deliberate application before changing the screen. Model responses must map to validated supported operations; invented financial facts or silently changed constraints are not acceptable interpretations. Keep supplied data and existing manual/controlled-language tools usable when model access is unavailable.

Use genuinely free model access if a suitable option is available. Verify pricing, quotas, data handling and overage behavior before choosing a provider; do not assume a free tier prevents charges. Paid AI-model API integration is deferred unless the owner later authorizes spending. If no suitable no-cost service is available, document that specific dependency and continue independent product work without claiming the interpretation milestone is complete.

Success for this milestone means varied ordinary requests produce correct, inspectable screening criteria, uncertainty is handled usefully, and failure preserves the user's current work. Measure interpretation quality on representative requests rather than accepting any syntactically valid response. The earlier failed local paraphrase experiment remains evidence about that experiment; it does not replace the new API-based direction.
