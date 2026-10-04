# Friendly Challenges

A private local notebook for two people to agree on a friendly challenge, record what happened, and settle the outcome together. Stakes are limited to bragging rights or a few ordinary favors. There is no money, payment processing, betting market or public feed.

The service stores one shared agreement in SQLite. Separate browser profiles hold the proposer, opponent and optional arbiter seats. The browser talks to the real local service; it does not simulate the other participants.

## Run locally

Requirements: Python 3.11+, a POSIX system with `fcntl.flock` (verification uses Linux), Node.js 22.18+ and npm. Pillow 12.3.0 decodes normalized evidence JPEGs; it is the only runtime Python dependency. No account, API key, paid service or model download is needed.

```sh
cd apps/friendly-challenges
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
npm ci
npm run build
python3 -m challenges --data-dir ./data --port 8767
```

Open `http://127.0.0.1:8767`. Keep that process running. For development, run `npm run dev` in a second terminal to rebuild changed browser files, then refresh the page. The Python service serves the built `dist` directory and the API on the same origin. This app deliberately binds only to loopback; it is not an internet deployment or a claim of multi-device operation.

## Try the complete flow

1. **Propose challenge:** enter your name, title, description, success criteria, evidence rule, deadline and nonmonetary stake. Save your private access link, then share the separate opponent invitation with another browser profile on this computer.
2. The opponent uses **Claim opponent seat** with their name. Claiming a seat is separate from accepting the agreement. They inspect the terms and use **Accept these terms**, or decline. Before acceptance, the proposer can revise the terms; a stale browser must review the new version before consenting.
3. Both participants use **Add evidence** for text, or **Choose evidence image** and review the normalized copy before **Add evidence with image**, for progress or results. The shared activity feed records author, server time and any supplied link. Corrections are additional entries; previous statements cannot be deleted.
4. Either participant uses **Propose result** with a named winner and reason. The other can agree or dispute. Agreement settles the challenge; disagreement opens a dispute without inventing a winner.
5. During a dispute, either participant can nominate an arbiter. The other must approve that exact nomination before an arbiter invitation can be issued. A third browser profile claims the nominated seat and records a reasoned decision. Participants can still settle together while arbitration is pending.
6. **Export record** downloads the terms, evidence descriptors and activity as JSON. **Export record with images** downloads a complete, script-free HTML record with the exact retained JPEGs for offline reading. Reloading or restarting the service with the same data directory preserves the record and existing seat access.

Each seat is a private capability, not a verified identity. Names are labels supplied by the people using the app. Anyone holding an access link can act as its seat; separate browser contexts demonstrate distinct permissions, not that distinct humans are present. Use separate browser profiles for a realistic demonstration. Do not post access or invitation links publicly.

## Agreement and resolution rules

- Acceptance freezes all terms. Every mutation carries the displayed revision; stale consent fails instead of silently applying to changed terms. The UI retains typed drafts when a refresh is required.
- Acceptance closes at the exact deadline. Time passing does not create a winner or alter the challenge status. Evidence at or after the deadline remains allowed and is permanently marked **late**. The server's wall clock is authoritative for this local notebook.
- Evidence is supplied testimony, not verified proof. Optional HTTPS links are validated for their shape and rendered safely; the app never fetches or verifies them.
- A participant cannot confirm their own result. A result, mutual void or arbiter decision becomes final in one transaction; competing later commands cannot settle the record again.
- **Offer to void** is one deliberate, permanent offer: its author agrees it stays available until the challenge ends. The other participant can confirm it later or ignore it. The offer cannot be withdrawn or replaced, and the UI warns before posting it. This preserves a mutual closing route even when other proposal limits are exhausted.
- Before an arbiter claims, either participant may withdraw the nomination; its invitation then stops working. After claim, the appointment cannot be replaced unilaterally or revoked. Both participants can still agree on a result or use the mutual void route.
- Terminal records remain readable and exportable. There is no delete, audit rewrite or undo operation that reverses another participant's consent.

## Retained image evidence

Each of the 40 append-only evidence entries may include one image; a challenge permits at most **eight images**. Choose a local PNG or JPEG of at most **8 MiB and 16 million pixels**. Animated/multiple-image inputs and other formats are rejected. The browser honors image orientation, fits the decoded image within **1024 × 1024** without upscaling, flattens transparency onto white, and encodes an sRGB JPEG of at most **512 KiB**. Generated metadata is stripped before preview. Review that exact normalized copy before posting: the original file and its filename, location and device metadata are not retained.

The server independently checks the complete JPEG framing, dimensions, metadata policy and actual Pillow decode. It keeps the exact reviewed bytes, their SHA-256, caption, participant and server receipt time together with one audit event in one SQLite transaction. Photos are unverified supplied claims; a hash identifies retained bytes and does not prove who took a photo, its capture time or the truth of the claim. Normalization can change pixels and colors, so this is not a forensic original-image archive.

Both participants and a legitimately claimed arbiter can use **View retained image**. The image API requires the same Bearer capability as the record; the browser verifies its length and hash against the authenticated descriptor before display. Closing a preview, switching seats or leaving the page retires the owned Blob URL. Images remain readable after settlement and service restart. There is no public image URL, token in a query string, edit, deletion or automatic eviction.

A failed or stale append preserves the exact selected preview and raw caption for review. If the response is lost, the append may already have committed: refresh and inspect the activity before deliberately trying again. The client never retries a mutation automatically. A newer edit must not be erased by an older response, and deliberately leaving an unsent draft requires confirmation.

**Export record with images** produces a self-contained HTML file with all retained JPEG bytes, accepted terms, resolution and complete public audit. It contains no scripts, private capabilities or capability hashes and needs no network connection. Treat the exported captions and photos as private content when sharing it. The existing JSON export contains descriptors, while image bytes are included in the separate HTML export. Neither format recreates private seats.

SQLite schema 2 adds a bounded image table. Valid existing schema-1 record text and historical events remain byte-identical during startup migration; only a successful first image append upgrades that private record to version 2. Missing, orphaned or mismatched media fails visibly rather than being silently repaired. A complete data-directory backup includes the images. The maximum retained image bytes are 4 MiB per challenge and 80 MiB per 20-challenge directory, excluding SQLite/record overhead; these are format limits, not a memory guarantee.

## Access, backups and recovery

The browser keeps up to 20 challenge access tokens in local storage for this origin. Incoming fragments are removed from the address bar; API authentication uses Bearer headers. Invitations are single-use, and each claimed seat receives an independently random token. Reissuing an unused invitation invalidates the old invitation. The database stores capability hashes, so the service cannot recover a lost raw access link for you.

Keep **My private access link** somewhere private before closing a browser that cannot save local storage. A storage failure does not invalidate the current in-memory session. A persistent warning, **Retry saving access** and a navigation warning keep unsaved access visible; losing that session without a recovery link still loses that browser's access. **Forget saved seat** removes only the selected browser credential after confirmation, preserving its server record and other remembered seats. Opening another seat's link in the same profile requires an explicit switch; one browser profile is intended to hold one seat per challenge.

**JSON and complete HTML exports are readable records, not access recovery or server backups.** They contain no access tokens, invitation tokens or stored capability digests, and there is no record-import endpoint. To back up the complete notebook and its valid capabilities, stop the service cleanly and copy its entire data directory. Restore that directory while the service is stopped, then use the original private links. Browser storage alone is not a backup.

The service takes a lifetime lock on its data directory. A second process cannot use it while the first service or its in-flight requests are still active. It rejects symlink data/lock/database paths at startup. It does not promise isolation from a malicious user who already controls the same operating-system account and database files. Corrupt stored records fail visibly instead of being replaced with an empty notebook.

## Bounds

One data directory holds at most 20 challenges, including completed records; nothing is silently evicted. Start a separate directory for another notebook after retaining backups and exports. Each challenge allows 10 terms edits, 40 evidence entries, 10 result proposals, 5 arbiter nominations, and at most 10 invitations per seat category. Responses to permitted proposals and the mutual void route remain available when proposal/evidence quotas are reached.

Names are limited to 40 characters; titles to 100; descriptions, success criteria and reasons to 500; evidence rules to 300; evidence text to 1,000; supplied links to 1,024. Deadlines must be in the future and within 365 days on creation/edit. Ordinary JSON requests are limited to 16 KiB; serialized records and JSON exports to 1 MiB. Image append requests use a separate, exact-length binary frame capped at 540,688 bytes. Complete HTML exports are capped at 12 MiB. Unknown fields, ambiguous duplicate JSON keys, invalid Unicode/numbers, malformed URLs and invalid stored state are rejected.

There is no remote image fetching, identity verification, notification system or public social graph. The local milestone covers the complete agreement-to-resolution experience; remote hosting and broader social features require a separate design.

The HTTP service admits at most 16 active connections. A shared 15-second total deadline covers the request line and all headers, even when bytes keep arriving; unfinished requests close without reflecting partial input. Header bytes remain capped at 16 KiB and socket inactivity at five seconds. Once headers finish, a separate 15-second total deadline covers the request body. Healthy requests can proceed when expired connections release their slots.

## Verify

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 -m compileall -q challenges tests
ruff check .
npm run check
npx playwright install chromium
npm run test:browser
```

`npm run check` runs TypeScript unit tests, ESLint, type checking and a production build. Playwright starts the real production Python service with an isolated temporary database on port 4250. To use an existing Chromium executable, set `CHROMIUM_PATH=/path/to/chromium` for the browser test command. Primary acceptance uses actual independent browser contexts and the real service; focused failure tests may intercept requests to reproduce outages and races.

The completed local milestone passes **43 Python tests, 22 TypeScript unit tests and 12 production Chromium tests**, plus Ruff, compilation, ESLint, TypeScript and the Vite production build. A focused rerun also verified the final persistent memory-only warning/retry extension. Independent reviews covered role/transaction boundaries, historical audit replay, HTTP framing/lifetime and browser credential/draft races. Root visually inspected desktop and 390-pixel mobile views and created a real challenge through the production UI. See `docs/runtime-verification.json` for the measured local environment and scope; GitHub issue #30 records durable commits and remote CI.

Issue #80 adds four real-socket regressions for slow request-line/header saturation, a deadline shared across complete header lines, and the independent body phase. The expanded local Python suite passes 47 cases; see `docs/2026-10-04-header-deadline-verification.json` for current verification evidence and limits.

## Image evidence verification (#87)

The completed image milestone passes **86 Python tests, 37 TypeScript tests and 24 distinct production Chromium cases**, with Ruff, compilation, ESLint, type checking and a production build. The 12 existing agreement cases pass unchanged. New native cases exercise three independent private profiles, real PNG/JPEG normalization and orientation, actual pixels and exact JPEG bytes, a complete HTML download, service restart, all eight image slots, deadline marking, stale/lost responses and draft/seat lifetime regressions. The [verification record](docs/2026-10-04-image-evidence-verification.json) preserves failures, corrections, artifact hashes and limits. The [backend CI receipt](docs/2026-10-04-image-evidence-backend-ci.json) separately records the earlier backend-only head and its original browser suite; the [final combined CI receipt](docs/2026-10-04-image-evidence-ci.json) records all 86 Python, 37 TypeScript and 24 browser cases passing on both the exact `68532bfc` push and its PR merge checkout. All thirteen project PR workflows passed.

Two complementary manual boundaries passed. A real **8,388,608-byte PNG with 16,000,000 pixels** normalized to a **7,245-byte, 1024 × 1024 JPEG** with independently checked red/green/blue/white samples; an 8 MiB + 1 replacement preserved the reviewed draft, and uploaded/retained bytes matched. Separately, **160 exact 512 KiB valid JPEGs across 20 challenges retained 80 MiB** through a different service process. Their complete eight-image HTML record was **5,605,432 bytes** with exact embedded media and public audit. Both fixtures use simple original imagery and legal padding to reach byte limits; they do not establish worst-case decode cost or a memory bound.

The manual checks use the built app and isolated temporary data. Choose new output directories; the source-image browser run requires a separately running local service:

```sh
python scripts/smoke_image_capacity.py --output /tmp/friendly-capacity-new
FRIENDLY_SOURCE_OUTPUT=/tmp/friendly-source-new node scripts/smoke_source_maximum.mjs --fixtures-only
FRIENDLY_SOURCE_OUTPUT=/tmp/friendly-source-new FRIENDLY_SOURCE_ORIGIN=http://127.0.0.1:8767 \
  CHROMIUM_PATH=/path/to/chromium node scripts/smoke_source_maximum.mjs
```

The source runner observes genuine native Blob arguments solely to verify the exact preview/upload bytes; it does not replace native decoding, upload or service state. Its timing is a single local observation, not a speed guarantee. Complete HTML and source artifacts stay local; no paid service or inference is used.
