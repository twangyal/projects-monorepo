# Project Ideas

These 17 projects are listed in my personal priority order. The descriptions reflect the concepts we refined and their intended use as portfolio projects.

## 1. Eye detector with agentic AI

Path: apps/gaze-navigator
Status: ACTIVE
Progress: Browser prototype includes session-only explicit camera calibration, pointer simulation, confined target resolution, practice inbox actions and gaze text entry, hands-free pause/resume/stop and page navigation, cancel-safe camera startup/cleanup, and a local held-out accuracy check. Hands-free keyboard scrolling and native Chromium CI cover core flows across four viewport sizes. A separate 14-case decision lab compares a geometric baseline with an optional local decision model and supports versioned report import/export. Physical webcam measurements, real model/Jev evaluation, live contextual decisions, and arbitrary browser control remain outstanding.
Description: A hands-free navigation assistant that uses an ordinary webcam to estimate where a user is looking and help them interact with technology. After calibration, the assistant highlights likely targets and lets the user confirm actions such as clicking, scrolling, or selecting controls. An AI decision model combines gaze information with interface context to resolve nearby elements and assist with navigation. The first portfolio version would focus on browser interfaces, with TypeSafe's Jev as a candidate decision model and an open-source alternative evaluated against the same tasks. Gaze tracking, decision-making, and browser control would remain separate components so each can be improved or replaced.

## 2. Schedule app that bricks your phone

Path: N/A
Status: BLOCKED
Progress: iPhone restriction enforcement is blocked in the current Linux environment: native Apple tooling (macOS/Xcode) and iPhone device verification are unavailable, and Family Controls entitlement approval is required for distribution. Blockers and native platform validation are tracked in GitHub issue #9; a browser scheduling prototype would not restrict phone apps.
Description: A calendar-driven focus app that restricts access to apps during scheduled activities while keeping necessary apps and a user-selected allowlist available. Users retain control by editing their calendar: changing or ending an event updates the corresponding restrictions. The project would start on iPhone and expand to Android, potentially sharing its calendar and settings interface through Flutter or React Native while using native components for phone restrictions. The portfolio version would demonstrate the complete flow from scheduling an activity to activating restrictions and restoring access. iPhone distribution would require Apple's Family Controls entitlement approval.[^ios]

## 3. DAW with AI and voice-based music creation

Path: apps/melody-studio
Status: MAINTENANCE
Progress: Melody Studio's core music sketchbook works: bounded microphone/audio capture, single-voice pitch detection, editable notes and timing, three synthesized instruments, layered playback, local autosave, project backups, and MIDI/WAV export. Session undo/redo, track duplication, transposition, and phrase repetition support reversible arrangement. Synthetic audio, domain, recorder lifecycle, storage, and production Chromium tests cover the core flow. Real microphone/vocal accuracy evaluation, broader device/browser validation, and generative AI arrangement assistance remain future work; existing assistance is deterministic and manual. MVP and arrangement milestones are complete in issues #8 and #10.
Description: A beginner-friendly digital audio workstation that turns hummed or sung musical ideas into editable notes played by different instruments. Users record a melody, review the detected pitch and timing, choose an instrument, and layer additional parts into a track. AI assistance helps develop the arrangement while preserving the user's control over individual notes and musical choices. The goal is to lower the barrier to music production for people who have ideas but do not play an instrument or know traditional production software. A first version would focus on capturing melodies, switching instruments, editing notes, and exporting a simple composition.

## 4. Git blame agent

Path: apps/git-history
Status: MAINTENANCE
Progress: A local Python CLI produces portable HTML/JSON reports for committed source ranges, with per-line blame, range patches, quoted commit messages, and rename evidence. Reads are bounded and repository configuration cannot silently replace objects, remap author names, or execute external evidence helpers. Reports disclose shallow/merge/truncation limits and never infer intent from diffs. Committed Python functions can be listed and selected by qualified name, including decorators and nested methods, and an evidence-linked synopsis makes attribution and available changes readable. The core offline portfolio workflow is complete in issues #11 and #13; bounded offline import of user-supplied discussion excerpts adds unverified source-linked context in issue #17 (124 tests across both compatible import formats). Optional pinned JavaScript/TypeScript syntax selection adds declarations, bound arrows and class/object methods in issue #34, with isolated resource-limited parsing and 177 discovered tests across Python 3.11–3.13. Python/manual ranges remain dependency-free. Committed source discovery now lists bounded Python/JavaScript/TypeScript candidates with literal filters and an immutable revision before function selection (#41); the expanded 188-case native-enabled suite passes Python 3.11–3.13 CI. Source fetching and semantic synthesis remain future milestones.
Description: A developer assistant that explains how and why code evolved by tracing lines and functions through commits, diffs, pull requests, and available discussions. Users select a piece of code and receive a readable history of its introduction and subsequent changes, with links to supporting evidence. The assistant distinguishes documented reasoning from its own inference when the original intent is missing. The main purpose is to help developers understand unfamiliar code and the decisions behind it. A portfolio version would investigate selected code in one repository and produce a source-linked explanation of its history. (Maybe make it an extension)

## 5. Clothing designer

Path: apps/clothing-studio
Status: MAINTENANCE
Progress: A local T-shirt concept studio provides adjustable silhouettes, colors/textures, clipped freehand sketches, an approximate photo overlay with direct/numeric placement, session undo/redo, validated local autosave/backups, and garment/preview PNG exports. The core concept-to-preview workflow is complete in issue #14, verified by 36 unit tests and 12 production Chromium tests, including import races, failed storage, startup draft preservation and PNG content/transparency. The overlay does not predict fit, drape, or body measurements; generated concepts and realistic virtual try-on remain future work.
Description: A clothing design workspace where users turn sketches, descriptions, and visual references into garment concepts, then preview them on an approximate representation of themselves created from an uploaded body photo. Users can explore silhouettes, fabrics, colors, and combinations before refining a design. The initial focus is visual concept development and virtual try-on, with the preview presented as an approximation of appearance. Sewing patterns and manufacturing specifications are longer-term extensions. A first portfolio version would support one garment category and a complete concept-to-preview workflow.

## 6. AI karaoke generator

Path: `apps/karaoke-studio`
Status: MAINTENANCE
Progress: Local 1–300 second songs use the real checksum-pinned Spleeter model for offline vocal/backing estimates, with three-track audition, supplied editable lyrics, draft/manual timing, saved projects, backing WAV/SRT and synchronized H.264/AAC MP4 export. Verified real-model CPU inference, production browser flow and decoded lyric-frame boundaries. Bounded session undo/redo makes lyric timing, removal and pasted-word drafts recoverable (#27). Retained directory handles and inherited media handles protect processing/publication/cleanup when storage parents move (#23). Full-song overlap inference with shared gain, 200 supplied lyric cues, bounded upload/storage/export and actual five-minute MP4 verification are complete in #33. Automatic lyric recognition/alignment, songs over five minutes and subjective/reference-stem quality evaluation remain future extensions.
Description: An app that transforms an uploaded song into a karaoke experience by separating vocals from the backing track and displaying lyrics synchronized with the music. Users can review or supply lyrics, correct recognition errors, adjust timing, and preview the result before exporting a karaoke video. The central experience is turning a song into a usable performance or practice track with minimal manual editing. A portfolio version would demonstrate song upload, vocal separation, lyric alignment, timing corrections, and export.

## 7. Direct a movie in VR

Path: apps/shot-studio
Status: ACTIVE
Progress: Native WebGL courtyard, two block performers, editable placement/actions/light, camera shot list, rehearsal/scrubbing, local drafts/JSON backups and silent WebM export. Session undo/redo and reversible shot ordering support film authoring. 28 unit tests/syntax checks and nine Chromium checks cover the desktop film flow, real decoded video frames/timing, persistence/imports, reversible edits and controlled lifecycle restoration. Failed startup draft reads now block automatic overwrites; exact raw recovery and explicitly confirmed replacement preserve user work (#44). Experimental immersive WebXR viewing includes animated performances, controller floor placement and reversible headset-view shot capture (#26); physical headset verification remains outstanding. Initial vertical slice completed in issue #19; reversible editing tracked in #20 and physical headset checks in #21.
Description: A virtual filmmaking studio where users step onto a set, direct animated characters, arrange lighting, and operate cameras from inside the scene. Users can stage performances, rehearse action, record multiple takes, and assemble shots into a conventional video. An additional mode would support immersive VR experiences. The goal is to make directing and cinematography accessible through spatial interaction with a virtual production environment. A first portfolio version would include one set, a small cast of animated characters, basic performance controls, camera placement, and video export.

## 8. Paper-trading app (SKIP THIS ONE)

Path: N/A
Status: IDEA
Description: A simulated trading environment where users describe strategies in natural language and turn those instructions into explicit trading rules. Before running a strategy, users review how the app interpreted their description, resolve ambiguities, and adjust its conditions. The app executes virtual trades and explains which rules triggered each action, alongside performance reports and a strategy journal. Historical testing could complement simulated live trading. A first version would focus on a limited set of supported strategy rules and a transparent description-to-rules-to-results workflow.

## 9. Spotify for couples

Path: apps/duet
Status: MAINTENANCE
Progress: Duet pairs two private participant seats, normalizes supplied audio locally, collects independent ratings, builds an explainable shared mix, synchronizes native playback, and saves dated song memories. The Linux loopback MVP works with separate browser profiles, durable SQLite/media storage, private recovery links, and token-free metadata export. Production browser checks cover both seats, drift/seek/pause, failed imports, recovery, and preserved drafts; real service restart and five-minute media processing are verified. Secure multi-device deployment and streaming-catalog integration remain future milestones; no remote listening or musical-similarity claim is made. Initial milestone: issue #18.
Description: A shared music experience that combines two people's tastes, supports listening together, and builds a musical history of their relationship. Couples can discover mutual favorites, create playlists for dates or trips, and attach songs to shared memories. Each person's preferences contribute to recommendations while leaving room to explore unfamiliar music together. Over time, the shared collection becomes a soundtrack to the relationship. A portfolio version would demonstrate pairing two profiles, creating a blended playlist, a shared listening session, and a timeline of songs linked to memories.

## 10. Art protection using color theory

Path: N/A
Status: IDEA
Description: A research project exploring whether changes to color and surrounding visual context can preserve an artwork's appearance for people while disrupting how image models learn from it. Inspired by differences between pixel colors and perceived colors, the tool would generate modified versions of artwork and compare their visual quality and effects on model behavior. The portfolio deliverable would include an artist-facing comparison interface and reproducible experiments. Whether perceptual ambiguity can provide useful resistance to AI training remains a hypothesis; results would report measured effects and limits rather than promise prevention. Existing image-perturbation research provides useful comparisons and evidence of bypasses to test against.[^art]

## 11. Online drawing board

Path: `apps/motion-studio`
Status: MAINTENANCE
Progress: Motion Studio provides local freehand and normalized image layers, editable transform keyframes, linear/hold/ease interpolation, preview/scrubbing, bounded undo/redo, IndexedDB autosave, validated project backups, PNG stills and worker-rendered animated GIFs. The drawing-to-animation flow is verified in production Chromium with independently decoded GIF frames and timing. Startup now gates editing until model/images restore; failed reads or invalid/undecodable records remain protected during in-memory edits/history/imports until explicit successful replacement (#46). The expanded suite passes 38 unit and 28 production Chromium cases, including delayed reads, denied access recovery, write failure and real corrupt PNG data. AI in-between artwork and private online saving/sharing remain future extensions.
Description: An account-free browser drawing and animation studio where users draw or upload artwork, set keyframes to define movement, and preview or export animations. Projects autosave in browser storage, with optional online saving through a private project link. Users teach motion by defining poses and timing at keyframes. AI could assist with generating or refining intermediate frames, while completed and corrected sequences provide examples for later motion learning. The first portfolio version would focus on a complete drawing-to-keyframes-to-animation workflow, followed by AI assistance.

## 12. Outfit rating based on your taste

Path: `apps/style-studio`
Status: MAINTENANCE
Progress: Style Studio learns from explicit Like/Pass outfit tags with a fitted personal logistic model, explains alignment, and suggests occasion-filtered owned-piece combinations in Match or Explore mode. Wardrobe photos, immutable saved looks, corrected ratings, bounded undo/redo, IndexedDB recovery, validated JSON backups and real PNG outfit boards complete the local flow. Verified with 51 unit tests and 29 production Chromium tests; photos remain manually tagged references, and scores are uncalibrated taste alignment rather than automatic recognition or fit prediction.
Description: A personal style assistant that learns from outfits a user likes, dislikes, and wears, then evaluates new looks against those preferences. It suggests combinations for particular occasions, explains how individual pieces work together, and helps users explore styles beyond their usual choices. Recommendations can draw from clothing the user already owns. The app supports all three goals: matching existing taste, developing a new style, and dressing for a specific occasion. A portfolio version would demonstrate preference learning, outfit feedback, and a few personalized alternatives.

## 13. AI-based stock screener

Path: `apps/stock-notebook`
Status: ACTIVE
Progress: The first local research milestone imports up to 500 annual-financial CSV rows, interprets a documented screening grammar into editable filters, and supplies source-linked facts, formulas and rule-based observations. Currency/date-aware comparisons, watchlists, notes, bounded history, IndexedDB recovery and real JSON/text exports complete the flow. Issue #35 adds up to five supplied annual periods per ticker, strict v1-to-v2 migration, latest-only screening and dated source-linked historical comparisons with explicit comparability/missing-data guards. The complete raw history survives JSON/report export and native browser recovery; 105 unit tests and 20 browser cases cover the expanded flow, plus an actual exact 2 MiB/500-row run. Issue #37 adds a complete latest-period exclusion audit with all failed applied rules, unrounded values and raw-field/source provenance in the UI and reports. The expanded flow passed 111 unit and 22 production browser tests, including 500 excluded companies with 8,499 reasons, maximum Unicode provenance and exact report/native reopen checks. The isolated learned-paraphrase trial in #36 failed development readiness and is not enabled. Broad language understanding and generated analysis remain outstanding; no live data or learned investment-quality claim is made.
Description: A stock research assistant that translates natural-language screening criteria into filters and analyzes the companies that match. Users receive a shortlist with source-linked explanations, relevant company and financial information, and a general outlook covering strengths, risks, and uncertainties. The app makes its interpretation of the criteria visible and distinguishes reported data from generated analysis. The central experience is moving from a broad investing idea to an understandable research summary. A portfolio version would focus on a defined company universe and a transparent screening-and-analysis workflow.

## 14. Casual betting social media

Path: `apps/friendly-challenges`
Status: MAINTENANCE
Progress: Friendly Challenges provides a real local two-party agreement, append-only evidence/activity, mutual settlement or voiding, and mutually approved third-party arbitration. SQLite transactions, exact-revision consent, one-use invitations, separate private seats, token-free exports and recovery controls preserve the shared record. Verified with 43 Python, 22 TypeScript and 12 production Chromium tests, including independent participant contexts and process restart. Stakes are nonmonetary; local browser roles and supplied evidence do not establish real-world identity or truth.
Description: A social app for friendly challenges such as "Joe bets Terry that he can finish the race," with favors and bragging rights as the stakes. Users agree on the terms, deadline, evidence, and outcome criteria before accepting a bet. Progress and results can appear in a social feed, creating a record of friendly competition. Money is excluded from the project. If an outcome is disputed, the bet can be voided or settled by a mutually chosen third party. A portfolio version would support proposing, accepting, documenting, and resolving a bet.

## 15. Personal handwriting detector

Path: N/A
Status: IDEA
Description: A note-reading app that adapts to an individual's handwriting using sample pages and user corrections. Users upload photographed or scanned notes and receive editable, searchable text, with uncertain words highlighted for review. Personalization focuses on recurring letter shapes, abbreviations, and vocabulary so the system becomes better suited to that person's writing. The goal is to make handwritten notes easier to read, find, and organize. A portfolio version would demonstrate initial personalization, note transcription, correction, and comparison with a general handwriting-recognition baseline.

## 16. Focal length converter

Path: `apps/lens-studio`
Status: MAINTENANCE
Description: A photo editor that approximates how an existing image would look under different lens and camera setups. It offers two modes: changing the field of view from a fixed camera position, and changing focal length together with virtual camera distance to keep the subject similarly sized while altering perspective. Users compare the original and simulated result side by side. Depth-aware reconstruction would support perspective changes, and wider or shifted views may require estimated or generated content for regions absent from the original photo. The project would present its outputs as simulations rather than exact recreations.[^lens]
Milestone: Lens Studio delivers local PNG/JPEG/WebP import, fixed focal framing, independently verified three-plane manual perspective, source/result comparison, bounded painting/history, IndexedDB recovery and real JSON/lossless PNG exports. Unknown regions stay transparent; learned depth, generated fill and calibrated camera reconstruction are not claimed. See its README and issue #31.

## 17. Track physiological state to create situations in a game

Path: `apps/composure`
Status: ACTIVE
Progress: Composure supplies an original playable observatory escape with declared simulated baseline/readings, fixed-step bounded tension, noisy movement, aim jitter and steadying, fuse/power/key/lock/exit objectives, optional authored scare, comfort settings, keyboard/pointer/touch controls, pause/restart and actual simulated-run JSON reports. Versioned preferences and best time persist locally; samples/events remain in memory. Eight unit and six production Chromium tests verify complete escape, loss, stale signal, lifecycle/input release, bounded reports, mobile layout and native preference recovery. Initial simulated milestone is complete in #39. A supported smartwatch connection and physical-device verification remain outstanding; no emotional or medical inference is made.
Description: A horror game that uses heart-rate readings from a supported smartwatch to influence character composure. Changes from the player's baseline become a gameplay tension signal, affecting actions through shaky aim, louder breathing, or fumbling a key during an escape. Frightening encounters can make subsequent actions harder, making composure part of surviving. The signal is a deliberate game mechanic rather than a diagnosis of the player's emotional state. A first portfolio version would include one supported smartwatch, a short escape scenario, bounded effects on character performance, and simulated readings so people can try the demo without a watch.

## Technical references

[^ios]: Apple Developer, [Requesting the Family Controls entitlement](https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement) and [Configuring Family Controls](https://developer.apple.com/documentation/xcode/configuring-family-controls).

[^art]: [Glaze: Protecting Artists from Style Mimicry by Text-to-Image Models](https://arxiv.org/abs/2302.04222) and [Adversarial Perturbations Cannot Reliably Protect Artists From Generative AI](https://arxiv.org/abs/2406.12027).

[^lens]: [ZoomShop: Depth-Aware Editing of Photographic Composition](https://lseancs.github.io/zoomshop/), a related research example of depth-aware image editing and newly exposed image regions.
