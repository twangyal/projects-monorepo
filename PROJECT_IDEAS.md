# Project Ideas

These 17 projects are listed in my personal priority order. The descriptions reflect the concepts we refined and their intended use as portfolio projects. The full destination and owner decisions for each are in [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md).

## Current focus (2026-10-25)

Only three projects are `ACTIVE`. All other implemented apps are `DEFERRED` until the owner explicitly resumes them.

| # | Project | Path | Status |
| --- | --- | --- | --- |
| 1 | Eye detector with agentic AI (Gaze Navigator) | `apps/gaze-navigator` | **ACTIVE (priority)** |
| 5 | Clothing designer (Clothing Studio) | `apps/clothing-studio` | **ACTIVE (priority)** |
| 6 | AI karaoke generator (Karaoke Studio) | `apps/karaoke-studio` | **ACTIVE (priority)** |
| 2 | Schedule app that bricks your phone | — | BLOCKED |
| 3 | DAW with AI and voice-based music creation (Melody Studio) | `apps/melody-studio` | DEFERRED |
| 4 | Git blame agent (Git History) | `apps/git-history` | DEFERRED |
| 7 | Direct a movie in VR (Shot Studio) | `apps/shot-studio` | DEFERRED |
| 8 | Paper-trading app | — | IDEA (skip) |
| 9 | Spotify for couples (Duet) | `apps/duet` | DEFERRED |
| 10 | Art protection using color theory (Color Context Lab) | `apps/color-context-lab` | DEFERRED |
| 11 | Online drawing board (Motion Studio) | `apps/motion-studio` | DEFERRED |
| 12 | Outfit rating based on your taste (Style Studio) | `apps/style-studio` | DEFERRED |
| 13 | AI-based stock screener (Stock Notebook) | `apps/stock-notebook` | DEFERRED |
| 14 | Casual betting social media (Friendly Challenges) | `apps/friendly-challenges` | DEFERRED |
| 15 | Personal handwriting detector | — | BLOCKED |
| 16 | Focal length converter (Lens Studio) | `apps/lens-studio` | DEFERRED |
| 17 | Track physiological state to create situations in a game (Composure) | `apps/composure` | DEFERRED |

Status meanings are defined in [AGENTS.md](AGENTS.md#project-status). Keep each entry below short: a status, the description, and a few lines on the current state. Delivery history belongs in git, not here.

---

## 1. Eye detector with agentic AI

Path: `apps/gaze-navigator`
Status: ACTIVE (priority)

Description: Gaze Navigator helps people who have difficulty using a mouse or keyboard interact with real websites through gaze and spoken instructions. A stable visible context circle shows the area and elements they are looking at. When they speak, the app captures that context, interprets the instruction with the rule baseline and optional on-device WaterSheep target matching, and performs the intended browser action. Core capabilities include links, controls, scrolling regions, back navigation, dictation and text correction, clarification of ambiguous targets, confirmation of consequential actions, accessible feedback, and immediate spoken pause/cancel. Success means useful real-website tasks completed with manageable effort and few unintended actions; the confined practice workspace and separate decision lab are intermediate milestones.

Current state: The Chrome MV3 extension is the primary product (owner decision 2026-10-14). The website provides onboarding, practice and the decision lab. The extension supports spoken navigation, dictation, text selection and correction, and most native form controls (checkboxes, radios, ranges, selects, dates, times, numbers, tabs, disclosures), all in software. It has not been evaluated with physical gaze tracking, real speech and intended users on real websites. That evaluation, and making the loop dependable, is the next priority.

## 2. Schedule app that bricks your phone

Path: N/A
Status: BLOCKED

Description: A calendar-driven focus app that restricts access to apps during scheduled activities while keeping necessary apps and a user-selected allowlist available. Users retain control by editing their calendar: changing or ending an event updates the corresponding restrictions. The project would start on iPhone and expand to Android, potentially sharing its calendar and settings interface through Flutter or React Native while using native components for phone restrictions. The portfolio version would demonstrate the complete flow from scheduling an activity to activating restrictions and restoring access. iPhone distribution would require Apple's Family Controls entitlement approval.[^ios]

Blocker: iPhone restriction enforcement needs macOS/Xcode, a physical iPhone and Family Controls entitlement approval, none of which are available here (GitHub issue #9). A browser prototype would not restrict phone apps.

## 3. DAW with AI and voice-based music creation

Path: `apps/melody-studio`
Status: DEFERRED (2026-10-25)

Description: Melody Studio is intended to become a full music-production DAW with the depth and creative control associated with FL Studio. It retains the voice-to-music vision: capture hummed or sung ideas, review and edit notes, choose instruments, layer parts, and use AI assistance while retaining detailed musical control. Users should be able to develop ideas into complete, polished productions through capable arrangement, editing, mixing and export workflows. The existing browser sketchbook, short capture/composition limits and simple instruments are prototype foundations to develop beyond, not the final scope. Exact production architecture and feature milestones remain to be designed.

Current state: A browser music sketchbook. It has microphone capture, single-voice pitch detection, a piano roll, several synthesized instruments, multi-track playback, volume, pan and filter automation, chord tools, section editing, local autosave and MIDI/WAV export, in a focused workspace. Mixing, effects routing, audio editing and real musician evaluation are missing.

## 4. Git blame agent

Path: `apps/git-history`
Status: DEFERRED (2026-10-25)

Description: A developer assistant that explains how and why code evolved by tracing lines and functions through commits, diffs, pull requests, and available discussions. Users select a piece of code and receive a readable history of its introduction and subsequent changes, with links to supporting evidence. The assistant distinguishes documented reasoning from its own inference when the original intent is missing. The main purpose is to help developers understand unfamiliar code and the decisions behind it. A portfolio version would investigate selected code in one repository and produce a source-linked explanation of its history. (Maybe make it an extension)

Current state: A local Python CLI and loopback browser workbench. It traces lines, functions and renames through blame, patches and commit messages, with optional GitHub PR and issue discussion context, and exports HTML/JSON.

## 5. Clothing designer

Path: `apps/clothing-studio`
Status: ACTIVE (priority)

Description: Clothing Studio is a professional garment-design environment with the depth and creative control of tools like CLO. Users develop sketches, descriptions, reference images, existing patterns or templates into editable three-dimensional garments. Real 2D pattern pieces link to 3D construction, with precise seams, darts, pleats, pockets, closures, measurements and layered garments. Credible material simulation supports drape, folds, movement and personalized fitting on adjustable avatars; photo-assisted body creation exposes correctable assumptions. AI proposes structured editable designs under user control. Multiple garment categories, outfits, size grading, reusable assets, version history, rendering and appropriate pattern/material/measurement/3D exports support design, presentation and physical production validation. A photo-overlay or single-garment prototype is an intermediate milestone.

Current state: A Fabra-style, 3D-first product editor (owner direction 2026-10-13/14) with tee, sweatshirt, hoodie, trouser and skirt templates. It has per-part fabrics, colors, prints and artwork; linked measured patterns with editable construction details (necklines, hoods, waistbands, trims, pockets, shoulder drop); entered body measurements; an approximate XPBD drape for tops and skirts; tech packs, colorways and a costed range plan; and SVG/DXF/GLB/PNG exports. The owner-requested PPF native solver investigation concluded without adopting an engine (summary in PRODUCT_DIRECTION). Missing: convincing material-dependent drape across all garments, AI style interpretation ("navy vertical stripes"), layered garments and personalized bodies.

## 6. AI karaoke generator

Path: `apps/karaoke-studio`
Status: ACTIVE (priority)

Description: Karaoke Studio should make the song-to-karaoke process as automatic as possible: upload a song, separate vocals and backing, automatically transcribe the sung lyrics, synchronize them with the music, and produce a usable preview for export. Users can edit words, line breaks and timings when mistakes occur. Manual tools support correction of automatic results; supplying all lyrics and manually timing each line must not define the normal intended workflow. Success includes real-song separation, transcription and alignment quality and low correction effort, alongside reliable exports. Automatic lyrics and synchronization are core unfinished milestones.

Current state: Local songs up to 10 minutes. Vocal/backing separation uses a checksum-pinned MDX-Net ONNX model, and lyrics (English plus other European languages) are recognized automatically with word timing by Parakeet via sherpa-onnx. Review tools fix words, timings and passages (insert, remove, fit, shift, find/replace, exclusions), with slow rehearsal, saved projects and portable backups that retain recognized word timing. Exports cover backing WAV, SRT and synchronized MP4. Missing: automatic lyrics accurate enough to skip pasting (about 31% word error on a developer benchmark), non-European languages, and real-user correction-effort evaluation.

## 7. Direct a movie in VR

Path: `apps/shot-studio`
Status: DEFERRED (owner, 2026-10-14)

Description: A virtual filmmaking studio where users step onto a set, direct animated characters, arrange lighting, and operate cameras from inside the scene. Users can stage performances, rehearse action, record multiple takes, and assemble shots into a conventional video. An additional mode would support immersive VR experiences. The goal is to make directing and cinematography accessible through spatial interaction with a virtual production environment. A first portfolio version would include one set, a small cast of animated characters, basic performance controls, camera placement, and video export.

Current state: A WebGL courtyard set with block performers, lighting, camera travel, takes, sequences with soundtrack, and WebM export. Deferred by the owner; no replacement platform chosen.

## 8. Paper-trading app (SKIP THIS ONE)

Path: N/A
Status: IDEA

Description: A simulated trading environment where users describe strategies in natural language and turn those instructions into explicit trading rules. Before running a strategy, users review how the app interpreted their description, resolve ambiguities, and adjust its conditions. The app executes virtual trades and explains which rules triggered each action, alongside performance reports and a strategy journal. Historical testing could complement simulated live trading. A first version would focus on a limited set of supported strategy rules and a transparent description-to-rules-to-results workflow.

## 9. Spotify for couples

Path: `apps/duet`
Status: DEFERRED (2026-10-25)

Description: Duet centers on Spotify integration and an automatically maintained shared musical timeline for a couple. Notable listening activity automatically adds events such as both people hearing the same song, a newly heard song or a new favorite, without requiring approval for every entry. Users can manually add, edit or remove timeline entries and attach text memories or photos to songs. Define understandable shared/new/favorite rules, prevent duplicate ingestion from undoing user curation, and verify Spotify access and data coverage. Shared recommendations, playlists and listening support this central experience. Existing uploaded-audio rooms and dated memories do not complete the Spotify-connected automatic timeline.

Current state: Paired private rooms with uploaded audio, independent ratings, shared mixes, synchronized listening, song memories with photos and named occasion mixes. A Spotify provider flow is implemented but untested with two real accounts.

## 10. Art protection using color theory

Path: `apps/color-context-lab`
Status: DEFERRED (2026-10-25)

Description: A research project exploring whether changes to color and surrounding visual context can preserve an artwork's appearance for people while disrupting how image models learn from it. Inspired by differences between pixel colors and perceived colors, the tool would generate modified versions of artwork and compare their visual quality and effects on model behavior. The portfolio deliverable would include an artist-facing comparison interface and reproducible experiments. Whether perceptual ambiguity can provide useful resistance to AI training remains a hypothesis; results would report measured effects and limits rather than promise prevention. Existing image-perturbation research provides useful comparisons and evidence of bypasses to test against.[^art]

Current state: A local comparison UI (neutral, solid, checker and striped surrounds) with exact PNG/HTML/project exports and a small reproducible Python experiment. There is no evidence yet of any effect on model training.

## 11. Online drawing board

Path: `apps/motion-studio`
Status: DEFERRED (2026-10-25)

Description: An account-free browser drawing and animation studio where users draw or upload artwork, set keyframes to define movement, and preview or export animations. Projects autosave in browser storage, with optional online saving through a private project link. Users teach motion by defining poses and timing at keyframes. AI could assist with generating or refining intermediate frames, while completed and corrected sequences provide examples for later motion learning. The first portfolio version would focus on a complete drawing-to-keyframes-to-animation workflow, followed by AI assistance.

Current state: A stage-first drawing and keyframe animation workspace with stroke and point editing, shapes and fills, imported artwork, interpolation, autosave and PNG, GIF and frame-ZIP export. AI in-betweening is not implemented.

## 12. Outfit rating based on your taste

Path: `apps/style-studio`
Status: DEFERRED (2026-10-25)

Description: A personal style assistant that learns from outfits a user likes, dislikes, and wears, then evaluates new looks against those preferences. It suggests combinations for particular occasions, explains how individual pieces work together, and helps users explore styles beyond their usual choices. Recommendations can draw from clothing the user already owns. The app supports all three goals: matching existing taste, developing a new style, and dressing for a specific occasion. A portfolio version would demonstrate preference learning, outfit feedback, and a few personalized alternatives.

Current state: Guided picture-based onboarding (owner direction 2026-10-14), a quick wardrobe starter, outfit suggestions from a small local preference model, wear diary and saved looks. A Pinterest or comparable integration has not been evaluated.

## 13. AI-based stock screener

Path: `apps/stock-notebook`
Status: DEFERRED (2026-10-25)

Description: A stock research assistant that translates natural-language screening requests into visible, editable filters and supports source-linked research on the companies that match. Use AI-model APIs specifically for request interpretation, with validation, clarification and deliberate application of the interpreted criteria. This requirement does not request financial-data APIs. Use suitable free model access when available; defer integrations that cost money unless spending is later authorized. Keep current supplied-data and manual screening workflows available when model access is unavailable. Preserve the broader source-linked research vision, distinguishing reported facts, derived observations and generated analysis; model interpretation is an unfinished product milestone.

Current state: CSV import of annual financials, a documented screening grammar compiled into editable filters, source-linked facts and observations, watchlists and notes. Model-based interpretation of requests is not implemented.

## 14. Casual betting social media

Path: `apps/friendly-challenges`
Status: DEFERRED (2026-10-25)

Description: A social app for friendly challenges such as "Joe bets Terry that he can finish the race," with favors and bragging rights as the stakes. Users agree on the terms, deadline, evidence, and outcome criteria before accepting a bet. Progress and results can appear in a social feed, creating a record of friendly competition. Money is excluded from the project. If an outcome is disputed, the bet can be voided or settled by a mutually chosen third party. A portfolio version would support proposing, accepting, documenting, and resolving a bet.

Current state: Private two-party challenges with immutable accepted terms, text and image evidence, mutual settlement or voiding, third-party arbitration, circles and comments, on a local Python/SQLite server. Not tested on physical devices with real users.

## 15. Personal handwriting detector

Path: N/A
Status: BLOCKED

Description: A note-reading app that adapts to an individual's handwriting using sample pages and user corrections. Users upload photographed or scanned notes and receive editable, searchable text, with uncertain words highlighted for review. Personalization focuses on recurring letter shapes, abbreviations, and vocabulary so the system becomes better suited to that person's writing. The goal is to make handwritten notes easier to read, find, and organize. A portfolio version would demonstrate initial personalization, note transcription, correction, and comparison with a general handwriting-recognition baseline.

Blocker: No licensed, checksummed handwriting-recognition model weights were obtainable from admitted sources in this environment. The feasibility corpus is preserved on the `archive/pre-cleanup-2026-10-25` branch (`docs/research/handwriting-feasibility`).

## 16. Focal length converter

Path: `apps/lens-studio`
Status: DEFERRED (2026-10-25)

Description: A photo editor that approximates how an existing image would look under different lens and camera setups. It offers two modes: changing the field of view from a fixed camera position, and changing focal length together with virtual camera distance to keep the subject similarly sized while altering perspective. Users compare the original and simulated result side by side. Depth-aware reconstruction would support perspective changes, and wider or shifted views may require estimated or generated content for regions absent from the original photo. The project would present its outputs as simulations rather than exact recreations.[^lens]

Current state: A comparison-first workspace with fixed-position focal framing, manual depth painting (brush, rectangle, polygon, color-region selection), three-plane perspective simulation, zoom/pan and PNG/project exports. Learned depth and generated fill are not implemented.

## 17. Track physiological state to create situations in a game

Path: `apps/composure`
Status: DEFERRED (owner, 2026-10-14)

Description: A horror game that uses heart-rate readings from a supported smartwatch to influence character composure. Changes from the player's baseline become a gameplay tension signal, affecting actions through shaky aim, louder breathing, or fumbling a key during an escape. Frightening encounters can make subsequent actions harder, making composure part of surviving. The signal is a deliberate game mechanic rather than a diagnosis of the player's emotional state. A first portfolio version would include one supported smartwatch, a short escape scenario, bounded effects on character performance, and simulated readings so people can try the demo without a watch.

Current state: A playable browser escape game with simulated or Bluetooth heart-rate input. The owner found it does not work as a browser app; the platform must be reconsidered before it resumes.

---

[^ios]: Apple Developer, [Requesting the Family Controls entitlement](https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement) and [Configuring Family Controls](https://developer.apple.com/documentation/xcode/configuring-family-controls).

[^art]: [Glaze: Protecting Artists from Style Mimicry by Text-to-Image Models](https://arxiv.org/abs/2302.04222) and [Adversarial Perturbations Cannot Reliably Protect Artists From Generative AI](https://arxiv.org/abs/2406.12027).

[^lens]: [ZoomShop: Depth-Aware Editing of Photographic Composition](https://lseancs.github.io/zoomshop/), a related research example of depth-aware image editing and newly exposed image regions.
