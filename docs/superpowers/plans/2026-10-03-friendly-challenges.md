# Friendly Challenges Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans with the ownership below. The user explicitly authorizes autonomous product decisions and execution. Root releases code after reviewing the specification; root alone owns Git, issues and integration.

**Goal:** Complete issue #30's real two-party proposal → agreement → evidence → shared outcome workflow, including mutually approved arbitration.

**Architecture:** A small Python standard-library HTTP service owns a transactional SQLite state machine. A TypeScript/Vite browser client consumes authenticated snapshots and commands; independent browser contexts demonstrate each private role. Append-only evidence and activity records explain how an agreement reached its outcome.

**Tech Stack:** Python 3.11+, SQLite, Node 24 tooling, TypeScript, Vite, native fetch/session storage, unittest, Ruff and production Playwright Chromium. No paid services, external identity provider, runtime network calls or uploaded files.

**Spec:** `docs/superpowers/specs/2026-10-03-friendly-challenges-design.md` is the authoritative wire contract, state machine, bounds and security model. All owners read it before writing code. This plan does not introduce alternate payloads.

## Global constraints

- Project is isolated at `apps/friendly-challenges`; excluded projects and catalog entries remain untouched. Python 3.11+ and Node 22.18+ are required; CI uses Node 24.
- Service port 8767, production browser port 4250, ephemeral HTTP test ports. At most 20 lifetime challenges per directory; no eviction.
- Per challenge: 10 terms edits, 40 evidence entries, 10 result proposals, 5 arbiter nominations, 10 opponent and 10 arbiter invitations; records/events validated at 1 MiB/256 events. One lifetime irrevocable mutual-void offer preserves a settlement route at other quotas.
- JSON requests are at most 16 KiB; source-reference URLs at most 1,024 characters. Deadline is integer epoch milliseconds, future and at most 365 days ahead on create/edit. IDs are 32 lowercase hex, independently random capabilities 64 lowercase hex.
- HTTP admission is bounded at 16 connections, with 5-second inactivity and 15-second whole-body limits; service directory is protected by a lifetime POSIX flock.
- Separate proposer/opponent/arbiter bearer capabilities; invitations can only claim their intended role once. Persist hashes, not raw capabilities.
- Accepted terms cannot change. Commands must match the current revision, and acceptance must match the exact displayed terms version.
- The server clock determines deadline behavior. Deadline passage never awards a winner; late evidence is explicitly marked.
- Settlement, mutual voiding and arbitration require the precise consent and proposal identities defined in the spec.
- Evidence and activity are append-only; exports exclude access credentials. No deletion, public directory, attachments or external evidence fetch.
- Production listens only on loopback and validates Host, Origin, body bounds, JSON shape and credentials before effects.
- Product copy states local multi-browser operation and unverified participant identity. Nonmonetary stakes only; no payments.

## Review focus

1. A proposal edited after the opponent reads it cannot be accepted by a stale browser. Task 1 pins revision/terms-version checks and Task 5 proves the visible conflict preserves drafts.
2. A used or invalidated invitation cannot claim another seat, including concurrent claims or an obsolete arbiter nomination. Tasks 1 and 2 prove atomicity and credential boundaries.
3. Opposing settlement commands cannot both finalize the same challenge. Task 1 checks terminal atomicity, proposal IDs and self-confirmation rejection; Task 5 checks the actual independent-role flow.
4. An old poll/request cannot overwrite a newly opened role or erase user drafts. Tasks 3 and 4 test generation/cancellation and disconnected recovery.
5. Restart, expired deadlines and exhausted activity quotas cannot silently rewrite agreement history or prevent the defined emergency resolution path. Tasks 1, 2 and 5 test the spec's bounds and explicit terminal behavior.

## Ownership and file map

- **git_history_review:** `challenges/domain.py`, `challenges/store.py`, `tests/test_domain.py`, `tests/test_store.py`; owns state transitions, validation, capabilities, SQLite and unit checks.
- **git_reader:** `challenges/__init__.py`, `challenges/__main__.py`, `challenges/server.py`, `tests/test_server.py`; owns strict HTTP, production service lifecycle and HTTP checks.
- **recorder:** `src/types.ts`, `src/api.ts`, `src/session.ts`, `tests/api.test.ts`, `tests/session.test.ts`; owns authoritative TS wire types and transport/recovery contracts.
- **next_project_assessment:** `src/main.ts`, `src/style.css`; owns the complete user interface and draft/race integration.
- **git_runner:** `tests/browser_server.py`, `tests/browser/*.spec.ts`; owns real independent-browser acceptance, recovery and interaction verification.
- **root:** package/config/index, README, CI, catalog, runtime verification, all Git/issue updates and final integration. **audio_engine** provides independent implementation review without overlapping owner edits.

### Task 1: transactional agreements and durable activity — git_history_review

**Interfaces:** `Store(data_dir:Path, clock:Callable[[],float]=time.time)` supplies `create(payload)`, `join(challenge_id,payload)`, `join_arbiter(challenge_id,payload)`, `get(challenge_id,token)`, `command(challenge_id,token,action,payload)`, `export(challenge_id,token)` and `close()`. `DomainError(code,message,status)` supplies bounded public errors. Implement the exact snapshot and command contracts in the spec. The HTTP owner calls these methods without implementing separate state rules. The client consumes only serialized public snapshots.

- [x] Write failing tests for strict input shapes, nonmonetary stake kinds, string/count/date limits, invitation-versus-seat distinctions, opaque token hashing and token-free snapshots/exports.
- [x] Run `python -m unittest tests.test_domain tests.test_store -v` (or discovery when the tests package has no initializer); confirm the failures exercise absent validation/state behavior.
- [x] Implement validation and transactional creation/claim/read commands with detached JSON snapshots; claim races must have exactly one successful winner and leave no raw secret in the database.
- [x] Write failing tests for stale terms acceptance, exact deadline equality, frozen accepted terms, late evidence marking, append-only history and participant permission checks.
- [x] Implement proposal/agreement/evidence transitions and pass the targeted tests with an injectable server clock.
- [x] Write failing tests for self-confirmation, obsolete proposal IDs, conflicting terminal commands, mutually approved arbiter nomination/claim, invite invalidation and final decision permissions.
- [x] Implement settlement/dispute/void/arbitration according to the spec, including bounds and the quota-safe resolution path.
- [x] Verify actual SQLite reopen durability and multi-connection conflicting commands. Run scoped unittest/Ruff and report counts/limits to root; do not commit independently.

### Task 2: production loopback service — git_reader

**Interfaces:** Import Task 1's `Store` and `DomainError`; expose `create_server(data_dir:Path, port:int=8767, *, dist_dir:Path|None=None, now=None)` and `python -m challenges --data-dir ... --port ...` CLI. Serve root's built `dist` and exact documented API routes.

- [x] Write failing real HTTP tests for allowed loopback Host/Origin, forbidden remote/cross-origin requests, malformed/duplicate/trailing JSON, transfer encodings, oversized bodies and missing/invalid Bearer credentials.
- [x] Implement bounded request handling and exact route-to-Store dispatch, with stable JSON errors, no reflected secrets, no permissive CORS and no API caching.
- [x] Write failing tests for traversal/symlink/non-asset static requests, CSP/referrer headers, unknown routes, methods and credential-free health checks.
- [x] Implement production static delivery and CLI shutdown, safe data-directory ownership and the specified single-service lifetime guarantee.
- [x] Test a real process restart with a persisted accepted challenge, evidence, roles and outcome; no test-only state machine may substitute for production service behavior.
- [x] Run scoped HTTP tests, compileall and Ruff; coordinate any shared API mismatch with the Store owner before reporting complete.

### Task 3: typed transport and private role recovery — recorder

**Interfaces:** Publish `src/types.ts` first from the frozen wire contract. Provide `request<T>(method,path,body?,token?,signal?):Promise<T>`, `ApiError` with status/code, `readLink(location)`, `loadSessions()`, `saveSession(challengeId,token)`, and `removeSession(challengeId)` exactly as specified; commands send displayed revisions and explicit proposal identities rather than replaying stale actions.

- [x] Write failing Node tests for fragment parsing/consumption, malformed capabilities, private storage failure, membership separation and recovery URLs without query-token leakage.
- [x] Implement bounded session records with explicit recoverable links, sanitized URL consumption and no automatic invitation claim on page load.
- [x] Write failing client tests for exact headers/body/route shapes, abort propagation, structured stale/authorization errors and failed responses that must not be treated as success.
- [x] Implement typed create/claim/read/command/export helpers; no automatic retries of mutations and no credentials in challenge JSON export.
- [x] Run scoped Node tests, ESLint and TypeScript; coordinate the stable public API with the UI and browser owners.

### Task 4: usable challenge workspace — next_project_assessment + root

**Interfaces:** Consume Task 3's stable types/API/session functions and the spec's role/status actions. Root establishes actual build/check scripts and self-only index policy.

- [x] Root creates isolated Node/Python tooling and installs the pinned, existing repository-compatible development dependencies.
- [x] Implement readable empty/create/invitation screens, explicit name claim, private recovery links and a complete frozen-terms agreement view.
- [x] Implement role/status-specific evidence, activity, settlement, dispute, mutual void and approved arbiter controls; clearly state deadline/late evidence and unverified identity semantics.
- [x] Implement polling with generation/cancellation guards, preserve draft fields and focus, and show request conflict/disconnection errors without discarding draft content or replaying commands.
- [x] Implement token-free JSON download and a usable local dashboard of this browser's private challenges; storage failure retains current in-memory access and exposes explicit recovery guidance.
- [x] Verify desktop/mobile keyboard/labels/layout, literal text rendering and safe reference links; run lint/typecheck/build and resolve integration mismatches.

### Task 5: independent full-flow verification — git_runner + root

**Interfaces:** The browser fixture runs the real production server against a fresh temporary database and root's production `dist`; separate contexts hold the three real roles. Use stable accessible labels from the UI, not implementation-only state injection for primary acceptance.

- [x] Test create → private invite → opponent claim → accept exact terms → shared progress/evidence → mutually agreed result with separate contexts, actual downloaded export and reload.
- [x] Test disagreement → matching mutual arbiter nomination → separate arbiter claim → final ruling and immutable final activity; prove participants cannot impersonate the arbiter.
- [x] Test preaccept edit/stale acceptance, decline/withdraw, mutual voiding, old/used invite rejection and late evidence with real server behavior.
- [x] Test draft preservation across polls/conflicts/disconnection, same-page role switching, malformed/stale recovery, storage unavailable, export without tokens, hostile text, desktop/mobile layout and no external network requests.
- [x] Root runs the combined Python/unit/lint/typecheck/build/production-browser gate once owners pass; independent reviewer checks actual state/permission/race behavior and owners fix concrete findings.
- [x] Root writes factual setup, private-link/backups, deadlines/evidence and limitations documentation plus path-scoped CI; inspect actual multi-browser output and record verification evidence.
- [x] Root reviews scoped diff, commits and pushes; preserve concurrent Astra commits through normal merges, never force-push. Update #30 and catalog only to the completion state verified by real evidence.
- [x] Check remote CI, fix regressions, and immediately reassess the next unblocked work outside the exclusions.

## Plan self-review

Tasks map the complete agreement, evidence, settlement and arbitration flow to one state owner, one HTTP owner and one typed browser contract. Each review focus has specific unit/HTTP/browser coverage. Test harnesses run the production implementation and do not create a fake shared backend. Exact schema/method/limit values remain in the authoritative reviewed spec; owners must not invent competing contracts. No external service, hardware or deployment approval is required for this local milestone.

## Verified local milestone

43 Python tests, 22 TypeScript tests and all 12 production Chromium tests pass. The final persistent access-warning/retry extension passed a separate focused production check. Ruff, compileall, ESLint, TypeScript and the Vite build pass. Independent review findings in HTTP framing, impossible arbiter-claim audit replay, same-document link handling, stale invitation display and pending-response draft/credential retention were fixed and verified. Desktop/mobile screenshots and an actual created challenge were inspected. Durable commit and remote CI follow in issue #30.

Durable milestone: `76f776eeaa9889dc5e3a093ed8f862820fdb1fc8` was pushed, all nine workflows passed (Friendly run `37161527325`), and #30 closed. Reassessment then integrated independently reviewed Karaoke PR #29 as `7e48fc1`, verified 12 TypeScript/13 browser tests and closed #27; already-integrated Duet #28 closed after confirming final successful CI.
