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

Open `http://127.0.0.1:8767`. Keep that process running. For development, run `npm run dev` in a second terminal to rebuild changed browser files, then refresh the page. The Python service serves the built `dist` directory and the API on the same origin. The default binds only to loopback. The optional HTTPS mode below supports a configured address on a trusted local network; there is no discovery, public hosting or reverse-proxy mode.

## Configure HTTPS for other devices

This optional mode requires **Linux with memfd and `/proc/self/fd` support**, in addition to the existing runtime requirements. Default HTTP keeps its existing POSIX requirements. The operator supplies a matching unencrypted TLS private key and certificate chain for one stable address. Each device must normally trust the issuer, and the certificate's subject alternative name must cover that address. Use your existing local certificate authority and device trust settings; this app does not install an authority or bypass browser warnings.

Choose an actual RFC1918 IPv4 address belonging to the computer, such as `192.168.1.42`, and a port. A lower-case DNS name may be used in the origin if all devices resolve it correctly and the certificate covers that name. The bind address must be a specific private or loopback IPv4 address; wildcard, public and IPv6 binds are refused. Keep access within a trusted LAN, configure any firewall allowance yourself, and do not forward the service from the public internet.

Create a fresh private operator setup file. This command refuses to overwrite an existing file and does not print its contents:

```sh
python3 - <<'PY'
import os
from pathlib import Path
import secrets
path = Path.home() / '.config/friendly-challenges/setup-key'
path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w', encoding='ascii') as output:
    output.write(secrets.token_hex(32) + '\n')
PY
```

The TLS private key and setup file must belong to the service user with exact mode `0600`; all supplied inputs must be ordinary files, not symbolic links. Certificate and private-key caps are 128 KiB and 32 KiB. The setup file contains exactly 64 lower-case hexadecimal characters, with at most one final newline. Supply all five optional flags together, using your actual address and paths:

```sh
python3 -m challenges --data-dir ./data --port 8767 \
  --bind 192.168.1.42 --origin https://192.168.1.42:8767 \
  --tls-cert /absolute/path/to/certificate-chain.pem \
  --tls-key /absolute/path/to/private-key.pem \
  --setup-token-file "$HOME/.config/friendly-challenges/setup-key"
```

The origin has no trailing slash, path or query. Its explicit port must match `--port`; port 443 instead omits `:443`. Configuration and listener binding are checked before the library is opened. The CLI prints only the public origin. Stop and restart the service to apply configuration or certificate changes.

Open the HTTPS origin and enter the setup file's contents in **Operator setup key** when proposing a new challenge. Retrieve the key privately with your local editor. It authorizes creation only: it cannot claim a seat, accept terms, inspect images or decide an outcome. The password field clears when the creation request is dispatched, and the browser does not save it. Invite the opponent and approved arbiter through their separate one-use links; each participant keeps their own private access link. Seat claim still does not mean consent to an agreement.

Creation and consent are never automatically retried. If a creation response is lost, it may already have committed; check any saved seat or received private access link before making another deliberate attempt. The setup key and database hashes cannot recover a credential that never reached the browser. A new attempt may consume another challenge slot. If the service address changes, open each original private access link with only its origin changed; browser storage is scoped to its previous origin. No new seats are minted.

HTTPS uses TLS 1.2 or newer, one exact Host and a matching Origin on every mutation. Forwarded/proxy and cross-site requests are rejected. JSON, images and image exports remain Bearer-only; no cookie or public image URL grants access. The server admits at most 16 connections, one request per connection, with a backlog of 16. Bounds are 5 seconds for TLS handshake, 10 seconds and 16 KiB/64 fields for headers, 5 seconds of socket inactivity, 15 seconds for a body, 30 seconds for a response and 75 seconds overall. Shutdown closes connections and joins handlers before releasing the library lock; if a handler remains after its 5-second join budget, the live library stays locked.

Automated same-host HTTPS checks can establish software behavior. Physical device certificate installation, mobile browser compatibility and separate-device use remain unverified until tested on actual devices. This configuration does not verify identities, evidence authenticity or consent outside the recorded actions.

## Try the complete flow

1. **Propose challenge:** enter your name, title, description, success criteria, evidence rule, deadline and nonmonetary stake. Save your private access link, then share the separate opponent invitation with another browser profile, or another device using the configured HTTPS origin.
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

**JSON and complete HTML exports are readable records.** They contain no access tokens, invitation tokens or stored capability digests and cannot restore private seats. Use the complete offline archive commands below to back up the notebook. Browser storage alone is not a backup; retain your original private links separately.

### Complete private library archives

Stop the service cleanly before creating an archive. Run these commands from the
app directory with its Python environment active:

```sh
python -m challenges.backup create --data-dir ./data --output ./notebook.friendly.zip
python -m challenges.backup inspect --archive ./notebook.friendly.zip
python -m challenges.backup restore --archive ./notebook.friendly.zip --data-dir ./restored-data
python -m challenges --data-dir ./restored-data --port 8767
```

The output archive and restored directory must not already exist; their parent
directories must exist. Keep the archive outside the source data directory.
The commands never merge, replace, rotate credentials, or delete existing records.
Creation refuses a running service, symlinks, unsupported data, or unsafe SQLite
sidecars. Inspection validates the complete contents and prints counts and byte
sizes without private names, captions or digests. Ctrl+C cancels before publication;
an incomplete result is not presented as a usable archive or restored notebook.

Archives preserve every private record's exact text, IDs, revisions, historical
activity, capability/invitation digests and original retained JPEG bytes. Restored
libraries use the trusted current database schema. Existing private links work
again, and still-unused invitations retain their single-use behavior. **An archive
cannot recover a lost raw access link.** Current time still controls deadline
checks; restore does not renew invitations, acceptance deadlines or agreements.

The archive is private, unencrypted data. Keep it as carefully as the notebook;
use the token-free JSON/HTML exports for a record you intend to share. Checksums
detect damaged bytes and do not authenticate a supplied archive or evidence.
No archive is uploaded, and there is no HTTP archive/import endpoint.

Archive commands require Linux with `renameat2(RENAME_NOREPLACE)` and a Python
SQLite build supporting `Connection.serialize()`. These capabilities permit
atomic publication into an absent directory; unsupported systems refuse restore.
The format is a strict stored ZIP, capped at **128 MiB**, containing at most 20
private records of 1 MiB each and 160 JPEGs totalling **80 MiB**. Generic edited ZIPs,
compressed members, unknown paths, missing images and inconsistent records refuse
before publication. The stopped source database is also capped at 128 MiB; it is
never vacuumed or migrated by archive creation. Operations have one five-minute
budget, with cancellation checked between bounded reads, record replay and JPEG
decodes. These bounds do not claim peak-memory limits.

After a successful restore, use the new data directory as the service's ordinary
`--data-dir`. Keep the old notebook and archive until you have verified access.
If final filesystem synchronization fails after the complete result has already
been published, the command reports that publication succeeded with durability
unconfirmed; it preserves that complete result for inspection.

The service takes a lifetime lock on its data directory. A second process cannot use it while the first service or its in-flight requests are still active. It rejects symlink data/lock/database paths at startup. It does not promise isolation from a malicious user who already controls the same operating-system account and database files. Corrupt stored records fail visibly instead of being replaced with an empty notebook.

## Bounds

One data directory holds at most 20 challenges, including completed records; nothing is silently evicted. Start a separate directory for another notebook after retaining backups and exports. Each challenge allows 10 terms edits, 40 evidence entries, 10 result proposals, 5 arbiter nominations, and at most 10 invitations per seat category. Responses to permitted proposals and the mutual void route remain available when proposal/evidence quotas are reached.

Names are limited to 40 characters; titles to 100; descriptions, success criteria and reasons to 500; evidence rules to 300; evidence text to 1,000; supplied links to 1,024. Deadlines must be in the future and within 365 days on creation/edit. Ordinary JSON requests are limited to 16 KiB; serialized records and JSON exports to 1 MiB. Image append requests use a separate, exact-length binary frame capped at 540,688 bytes. Complete HTML exports are capped at 12 MiB. Unknown fields, ambiguous duplicate JSON keys, invalid Unicode/numbers, malformed URLs and invalid stored state are rejected.

There is no remote image fetching, identity verification, notification system or public social graph. The local milestone covers the complete agreement-to-resolution experience; remote hosting and broader social features require a separate design.

The HTTP service admits at most 16 active connections. A shared 15-second total deadline covers the request line and all headers, even when bytes keep arriving; unfinished requests close without reflecting partial input. Header bytes remain capped at 16 KiB and socket inactivity at five seconds. Once headers finish, a separate 15-second total deadline covers the request body. Healthy requests can proceed when expired connections release their slots.

## Verify

HTTPS verification also needs the OpenSSL command-line tool to generate original temporary test certificates. Python's native TLS tests use normal CA and hostname validation. Isolated Chromium HTTPS cases allow only the exact generated fixture public-key fingerprint; production has no trust bypass. These cases launch fresh HTTPS services on available ports and clean up their own private files and processes.

An optional maximum HTTPS gate creates a **new isolated** 20-challenge notebook with all three original seats and 160 distinct exact-512-KiB JPEGs. Reserve at least 1 GiB of free space. From this app directory:

```sh
python3 scripts/smoke_https_maximum.py --output /path/to/new-friendly-https-evidence --fixtures-only
python3 scripts/smoke_https_maximum.py --output /path/to/new-friendly-https-evidence --run-prepared
```

Preparation freezes original record/image expectations before transport verification. The run uses strict native CA/hostname verification, downloads complete private images and HTML records through real HTTPS, then repeats after restarting its own CLI service on the same port. It compares exact private record text, original seat access, public audit, retained/embedded JPEG bytes and independently decoded colors. The prepared library and recovery material are private; keep that directory local. Only sanitized hashes/results belong in public evidence. The runner closes its own processes and never operates on an existing user notebook. Simple solid-color JPEGs use legal marker padding to reach the byte cap; they do not represent worst-case photographic complexity or a memory guarantee.

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

## Trusted-LAN HTTPS verification (#108)

Version 0.4 passes **194 Python tests**, **42 TypeScript tests**, compilation, Ruff, ESLint, type checking and the production build. Chromium verification covers **34 distinct cases**: the unchanged 28-case suite passes in 102.852 seconds, and six new HTTPS cases pass across retained runs. These scopes are recorded separately, not presented as one final local combined invocation. Both corrected-head CI events pass the complete 194 Python, 42 TypeScript and 34-case Chromium suites. See the [integration receipt](docs/2026-10-04-https-lan-verification.json), [producer evidence](docs/2026-10-04-https-lan-producer.json) and [client evidence](docs/2026-10-04-https-lan-client.json).

The [independent protocol oracle](docs/2026-10-04-https-lan-protocol.json) verifies normal CA/name/expiry checks, actual 16-slot admission, real 5-second handshake and 10-second trickled-header deadlines, exact header caps, setup-only creation, Bearer-only images, claim-versus-acceptance, held-lock shutdown refusal and same-port restart. Body/response/total/join timing branches use explicitly shortened budgets. The separate 8 MiB static-response probe checks transport/backpressure with opaque bytes, not image capacity. An [actual private-interface check](docs/2026-10-04-https-lan-private-interface.json) also passes strict CA/IP-SAN validation and original-seat restart recovery through the workspace's RFC1918 address; it remains same-host traffic.

The [native receipt](docs/2026-10-04-https-lan-native.json) covers three independent original seats, changed terms and stale-consent refusal, exact reviewed PNG/JPEG normalization, private image access, mutually approved arbitration and the final immutable result. Complete JSON/HTML exports preserve the expected 13 audit events and embedded JPEG bytes; the retained 354-byte and 553-byte images independently decode within one channel value of the original literal colors. Restart preserves the original roles, records and images. A source review and actual native RED found a deferred private link that remained hidden after successful creation; a narrow completion fix now displays it for explicit consent. Earlier fixture mistakes involving recovered-role readiness, seat-replacement confirmation and dashboard button selection remain documented separately. The [review receipt](docs/2026-10-04-https-lan-review.json) preserves the finding and resolution.

The first [maximum HTTPS run](docs/2026-10-04-https-lan-maximum.json) passes in **33.880 seconds**: 20 resolved records, three original seats per record and 160 distinct exact-512-KiB JPEGs retain **80 MiB** of image bytes across same-port CLI restart. All **960 authenticated image reads** match, and all **40 complete 5,607,835-byte HTML exports** have independently checked public audit, embedded JPEG bytes and decoded colors. Private record text stays exact. Export-generation timestamps may differ; complete HTML bytes are not claimed identical across time. Both owned service processes close cleanly. Fixture preparation had one event-name typo corrected before transport execution; the actual HTTPS run needed no repair.

No domain, schema, archive format or consent rule changes. Physical device trust setup and browser compatibility remain unverified; no production certificate bypass, deployment or system network change was made.

## Complete archive verification (2026-10-04)

Issue [#103](https://github.com/twangyal/projects-monorepo/issues/103) passes the
complete **154 Python and 37 TypeScript tests**, Ruff, compilation, ESLint, type
checking and build. Sixteen independent original fixture cases cover physical ZIP
admission, private historical replay, exact legacy text, media associations,
pinned file descriptors, cancellation and competing destination creation. Four
new real browser/CLI cases pass, including original proposer/opponent/arbiter
access, pending invitations used exactly once, withdrawn/consumed refusal, native
image/JSON/HTML downloads and real service restart. Existing 24 browser cases are
unchanged; both published-head CI runs pass all 28 browser cases.

A frozen independent maximum uses 20 complete challenges and 160 original,
decoded **512 KiB JPEGs (80 MiB)**. Its actual **84,198,426-byte** archive passes
create, inspect and restore; every original private record TEXT and JPEG hash
survives a separate restored service and another complete process restart. Source
database bytes remain unchanged. Original private seats work for every record,
and all embedded image bytes/public history match the original expectations.
Live export/server timestamps naturally differ. The full probe took 68.227 seconds;
CLI create, inspect and restore took 5.630, 6.206 and 16.543 seconds respectively.

The valid 37×23 RGB JPEGs use legal padding to reach the byte cap; this measures
retained byte topology, not maximum-pixel decoding, complex compression, exact
128 MiB container admission or peak memory. The large probe uses real CLI/HTTP;
the separate smaller fixture covers browser rendering and actual downloads.
Run against independent temporary data after building the ordinary web app:

```sh
python scripts/smoke_library_archive.py --output /tmp/friendly-archive-check
```

The output directory must be new. `--fixtures-only` freezes the original inputs;
`--run-existing --output DIR` then verifies those same inputs without replacing
them. The runner launches only its own short-lived loopback services. Its archive,
databases and original private access links stay in private local files; never
publish them as CI artifacts or share them as public record exports.

[Integration evidence](docs/2026-10-04-library-archive-verification.json),
[independent oracle evidence](docs/2026-10-04-library-archive-oracle.json),
[native evidence](docs/2026-10-04-library-archive-native.json) and
[maximum evidence](docs/2026-10-04-library-archive-maximum.json) preserve actual
hashes, observed failures, repairs, timing and limits.

Both [push](https://github.com/twangyal/projects-monorepo/actions/runs/37224780335)
and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37224783061) CI
at `112fad9afe1487e0d7b4af26a4283636a9e99628` pass all **154 Python, 37 TypeScript
and 28 browser tests**, Ruff, compilation, ESLint, type checking and build. The
runs use CPython3.11.16, Node24.21.0 and Chromium153.0.8010.12. All thirteen
project PR workflows pass. The [CI receipt](docs/2026-10-04-library-archive-ci.json)
records exact branch/merge checkouts, counts, timing and log hashes.

The first published HTTPS head passed all 194 Python and 42 TypeScript checks in both CI events, but each native run stopped at 33/34: the new three-seat test read an empty arbiter invitation before the actual request completed. The test now waits for the returned link with the expected origin, challenge and arbiter capability before navigating. Its full native flow passes locally with the unchanged 90-second timeout and original consent, image, audit and restart assertions. The [first CI receipt](docs/2026-10-04-https-lan-ci-first.json) and [focused readiness verification](docs/2026-10-04-https-lan-invitation-readiness.json) retain the original failure and repair evidence.

Exact corrected-head [push CI](https://github.com/twangyal/projects-monorepo/actions/runs/37235642896) and [PR CI](https://github.com/twangyal/projects-monorepo/actions/runs/37235646604) at `e4c71afde39b4934bee9311522708cda1d33f82c` each pass **194 Python, 42 TypeScript and all 34 browser cases**, plus compilation, lint, type checking and build. The PR checkout has the identical source tree; all thirteen project PR workflows pass. The [final CI receipt](docs/2026-10-04-https-lan-ci.json) preserves actual checkouts and logs. Physical two-device certificate trust and browser acceptance remain separately open in [#111](https://github.com/twangyal/projects-monorepo/issues/111).

Version 0.4.1 rejects bare hexadecimal final hostname labels such as `0x`, `127.0.0x` and `name.0x` before TLS configuration is admitted (#112). Browsers normalize or reject these spellings, so accepting them produced unusable exact-origin links. Canonical private/loopback IPv4 and ordinary lowercase DNS remain supported. Actual helper/config regressions cover default and explicit ports with valid controls; the [shared verification receipt](../../docs/2026-10-04-canonical-https-origins.json) distinguishes the passing targeted checks from pending published-head CI.
