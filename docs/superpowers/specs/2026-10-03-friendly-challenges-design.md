# Friendly Challenges — a private agreement and evidence record

Idea #14, issue #30, `apps/friendly-challenges`, branch Astra. Root owns this milestone. The user's autonomous instruction authorizes these architectural choices; root reviews this contract before implementation. Build a genuine shared propose → claim → accept → document → resolve/dispute → mutually void or arbitrate → reopen/export workflow. Stakes are favors or bragging rights; there are no money, odds, payments, escrow, identity-verification or automatic truth-detection features.

## Architecture and product boundaries

A Python 3.11+ standard-library HTTP service owns a SQLite database. A TypeScript/Vite DOM client uses the same origin and polls the selected challenge every second. Bind only `127.0.0.1`; production default port **8767**, production Playwright port **4250**, `port=0` for HTTP unit tests. Test real independent browser contexts against the actual server. This verifies local shared state, not internet hosting or separate-device access. No accounts, public user directory, cross-challenge feed, external API, source fetching, file upload, media processing or runtime ML dependencies.

Each standalone challenge has a proposer, one separately claimed opponent seat and optionally one mutually nominated arbiter. The activity feed is visible only to its capability holders. Names are user-supplied labels, never verified identities. Whoever holds a seat capability can act as that seat; the same human can hold several capabilities. Separate contexts prove access isolation, not distinct human identity. A proposer cannot accept, confirm their own result, or adjudicate merely because they created the record.

Terms may be edited by the proposer before acceptance; there is no counteroffer protocol or chat. The opponent can inspect, accept, decline, or ask the proposer outside the app to revise. Acceptance records the exact terms version and freezes all terms. Evidence is append-only text with an optional public-link-shaped HTTPS URL. It records what a participant supplied, not independently verified proof. Corrections are new entries; no participant or arbiter can erase another statement or the audit trail. There is no challenge DELETE endpoint.

## Bounds and validation

- **20 challenges** per data directory, including terminal records; this is a visible total quota. No hidden eviction. A stopped-service backup preserves the directory; a separate new data directory starts another notebook. Exports do not silently replace server records.
- Participant/nominated names: trimmed 1–40 characters. Terms title: trimmed 1–100; description and success criteria: 1–500 each; evidence rule: 1–300. Evidence text: 1–1,000; optional URL: at most 1,024; action reasons: 1–500, except affirmative consent responses may use empty reason. Preserve paragraph newlines/tabs; reject NUL, unsupported C0/DEL controls and invalid Unicode. No rendering via innerHTML.
- Terms deadline: finite integer epoch milliseconds, strictly later than the current server time and at most 365 days ahead on create/edit. All timestamps/revisions/counts are nonnegative safe integers; booleans must be actual booleans. Existing past deadlines remain valid on database reload.
- Per challenge: **10 terms edits**, **40 evidence entries combined**, **10 result proposals**, **5 arbiter nominations**, **10 opponent invitations issued including creation**, and **10 arbiter invitations issued across nominations**. A claimed seat is not replaceable. Exactly one outstanding lifetime mutual-void offer is supported (details below).
- Every successful mutation appends exactly one event and increments one challenge revision. The operation quotas bound normal lifetime growth below 128 events; validators permit at most **256** as a corruption bound. Do not consume a generic event allowance that blocks settlement. Responding to the last permitted result/nomination and offering/confirming mutual void remain available at the proposal/evidence limits.
- JSON request bodies: **16 KiB**; compact UTF-8 challenge records, snapshots and metadata exports: **1 MiB**. These field/count limits leave ample room for terminal events; validate size before publication. Names, titles and reasons never appear in exception diagnostics verbatim.
- IDs: 32 lowercase hex; invite/seat tokens: independently generated 64 lowercase hex using `secrets.token_hex`. Never derive a seat token from an invitation. Store only SHA-256 capability digests and compare with `hmac.compare_digest`; neither raw tokens nor digests enter snapshots, feed events, exports or logs.
- Validate exact object keys and nested shapes; reject duplicate decoded JSON keys, unknown versions, nonfinite constants/numbers, malformed encoding and excessive nesting before changing state. Validate stored records on startup and reads; corruption is visible and never replaced by defaults.

URL validation is syntactic, not proof that a page is public: require HTTPS, an ASCII DNS hostname with at least two labels, no credentials, IP literals, explicit port, query, whitespace/control or backslash. Reject localhost and `.localhost`, `.local`, `.internal`, `.test` names, including browser-style numeric IPv4 forms such as `127.1` and `0x7f.1` (the final DNS label must contain an ASCII letter and must not itself be a hexadecimal IPv4 number such as `0x1`). Also reject a numeric final host label, including decimal/octal/hex forms browsers interpret as IPv4 (for example `127.1`, `0x7f.1`, `0177.0.0.1`); a canonical-IP-only check is insufficient. Permit bounded percent-encoded paths/fragments but reject malformed percent escapes and encoded control bytes. Store the supplied accepted URL; do not resolve DNS or fetch previews. Render only escaped links with `target="_blank" rel="noopener noreferrer"`, plus “Supplied link; not fetched or verified.” A link may disappear or require access despite passing the syntax check.

## Shared wire types — `src/types.ts`

The client owner publishes this file first. JSON uses these exact camelCase field names; Python dictionaries match them. Types and enums are independently enforced on the server. `Id` is a string constrained as above.

```ts
export type Role = 'proposer' | 'opponent' | 'arbiter';
export type Party = 'proposer' | 'opponent';
export type Seat = 'opponent' | 'arbiter';
export type Status = 'proposed' | 'active' | 'disputed' | 'resolved' | 'voided' | 'declined' | 'withdrawn';
export type Outcome = Party | 'void';
export type Stake = 'bragging-rights' | 'make-a-drink' | 'pick-a-movie' | 'do-the-dishes';
export interface Terms { title: string; description: string; successCriteria: string;
  evidenceRule: string; stake: Stake; deadline: number }
export interface Profile { name: string }
export interface Evidence { id: string; author: Party; text: string; url: string | null;
  createdAt: number; late: boolean }
export interface ResultProposal { id: string; proposedBy: Party; outcome: Party; reason: string;
  status: 'pending' | 'rejected'; createdAt: number; respondedAt: number | null }
export interface VoidProposal { id: string; proposedBy: Party; reason: string; createdAt: number }
export interface ArbiterNomination { id: string; name: string; proposedBy: Party; reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; createdAt: number; respondedAt: number | null }
export interface Resolution { outcome: Outcome; method: 'mutual' | 'arbiter'; by: Role;
  reason: string; decidedAt: number; proposalId: string | null }
export interface LimitsUsed { termsEdits: number; resultProposals: number; arbiterNominations: number;
  opponentInvites: number; arbiterInvites: number }
export interface Snapshot { id: string; revision: number; status: Status; termsVersion: number;
  terms: Terms; acceptedAt: number | null; createdAt: number; serverTime: number;
  deadlinePassed: boolean; myRole: Role;
  profiles: { proposer: Profile; opponent: Profile | null; arbiter: Profile | null };
  evidence: Evidence[]; events: ChallengeEvent[]; resultProposal: ResultProposal | null;
  voidProposal: VoidProposal | null; arbiterNomination: ArbiterNomination | null;
  resolution: Resolution | null; limitsUsed: LimitsUsed }
export interface Creation { challengeId: string; token: string; inviteToken: string; challenge: Snapshot }
export interface Claim { challengeId: string; token: string; challenge: Snapshot }
export interface Invitation { inviteToken: string; challenge: Snapshot }
export interface ChallengeExport { schemaVersion: 1; exportedAt: number;
  challenge: Omit<Snapshot, 'myRole' | 'serverTime'> }
```

`ChallengeEvent` is a discriminated union with common `{seq:number, at:number, actor:Role, kind, details}`. `seq` equals the resulting revision (creation is revision/seq 1). Use these exact `kind → details` pairs; details are detached snapshots, never live references:

- `created → {name,terms,termsVersion}`; `terms_edited → {terms,termsVersion}`; `invite_issued → {seat}`; `opponent_joined → {name}`; `accepted → {termsVersion}`.
- `declined → {reason}`; `withdrawn → {reason}`; `evidence_added → {evidence:Evidence}`.
- `result_proposed → {proposal:ResultProposal}`; `result_responded → {proposalId,accept:boolean,reason}`.
- `void_offered → {proposal:VoidProposal}`; `void_confirmed → {proposalId}`.
- `arbiter_nominated → {nomination:ArbiterNomination}`; `arbiter_responded → {nominationId,accept:boolean,reason}`; `arbiter_withdrawn → {nominationId,reason}`; `arbiter_joined → {nominationId,name}`; `arbiter_decided → {outcome:Outcome,reason}`.

Initial snapshot: proposed, termsVersion 1, acceptedAt/resolution/proposals/nomination null, empty evidence, proposer profile set, other profiles null, limitsUsed all 0 except opponentInvites=1. Creation's initial invitation is covered by `created`, not a second event. Joined names are immutable. Exports include all evidence/events and accepted terms, with no capabilities, hashes, private invitation bookkeeping, or hidden database fields. `exportedAt` and `deadlinePassed` are computed with the same captured export clock.

## State machine and consent

All member writes require the exact current `revision`; stale writes return **409** before any command publication. Polling and export do not increment revision. Terms edits increment both revision and termsVersion. Accept additionally supplies the reviewed `termsVersion`; result/void/arbiter responses additionally supply the current proposal/nomination ID. A UI never silently retries a conflicted consent against new state.

| Operation | Role and preconditions | Result |
|---|---|---|
| Claim opponent | Valid unconsumed opponent invite, proposed, empty opponent slot | Set name/new seat capability; consume invite; remain proposed. Claiming is not acceptance. |
| Edit terms | Proposer, proposed, edits <10; validate future deadline | Replace terms, increment termsVersion; existing opponent stays claimed and must accept the new version. |
| Accept | Opponent, proposed, exact termsVersion, server time `< deadline` | active; acceptedAt set; terms immutable forever. |
| Decline / withdraw | Opponent / proposer respectively, proposed; reason required | declined / withdrawn terminal. Neither accepted nor expired proposals gain a winner. |
| Add evidence | Either party, active or disputed, <40 entries | Append with author/time from server; `late = createdAt >= deadline`. Late evidence is allowed and visibly labeled. |
| Propose result | Either party, active or disputed; no pending result; proposals <10 | Current pending proposal with unique ID; status unchanged. Outcome names a party, never inferred from deadline. |
| Respond to result | Other party, exact pending proposal ID | Accept → resolved by mutual consent. Reject with nonempty reason → disputed and proposal marked rejected. |
| Offer to void | Either party, active or disputed; no previous void offer | Store one unique lifetime offer. It remains available until terminal resolution, including while result/arbitration actions continue. |
| Confirm void | Other party, exact void proposal ID, active or disputed | voided by mutual consent. No unilateral void. |
| Nominate arbiter | Either party, disputed; no claimed arbiter; previous nomination null/rejected/withdrawn; nominations <5 | Pending nomination. Proposer of nomination gives first consent; no invite exists yet. |
| Respond to arbiter | Other party, exact pending nomination ID, disputed | Approve → approved; reject with reason → rejected. Approval permits invite issuance; it does not claim the arbiter seat. |
| Withdraw nomination | Either party, disputed, same pending/approved nomination, arbiter unclaimed | withdrawn; invalidate any issued invitation immediately. A later nomination needs fresh mutual consent. |
| Claim arbiter | Valid current arbiter invite; approved current nomination; disputed; empty arbiter slot | Consume invite and create distinct arbiter capability. Require supplied trimmed name equal nominated name; this is a label check, not identity verification. |
| Arbiter decision | Claimed arbiter, disputed; explicit outcome and nonempty reason | resolved for party outcome or voided for void; method arbiter. |

Mutual settlement may continue during arbitration. First valid terminal transaction wins; every later command fails without another event. All terminal states are immutable except private invitation invalidation performed in the same transition. A terminal transition clears resultProposal/voidProposal, retains nomination/profiles/evidence/feed, and invalidates unclaimed invites. Existing seat capabilities retain read/export access. Declined/withdrawn records have no Resolution; resolved/voided records must have one. Mutual resolution reason is the original result/void offer reason; `by` is the confirming other party, `proposalId` identifies that offer. Arbiter resolution uses its decision reason and null proposalId.

The single lifetime void offer is a deliberate small-scope tradeoff: its author explicitly agrees “My offer to void remains available until this challenge ends.” It cannot be withdrawn or replaced; the other party can ignore it or confirm later. It consumes no result/nomination allowance, so both parties always retain a way to close an unresolved challenge after other quotas are exhausted. The UI explains this before posting. There is no rejection event for an ignored offer and no automatic void.

After an arbiter claims the approved seat, neither party can revoke or replace that appointment. This prevents shopping for another decision maker; mutual settlement/void remains possible. Losing the arbiter capability does not authorize the server to invent a replacement. An unclaimed invitation may be reissued within quota or its nomination withdrawn. Any consenting party can issue an arbiter invitation; only proposer can reissue an opponent invitation while its seat remains empty/proposed. Every reissue invalidates the previous invitation in the same transaction.

Time is the service's finite wall-clock value, captured once inside each transaction. At the deadline, acceptance is closed and new evidence is late. Passage of time only changes the derived `deadlinePassed` display, never status, consent, winner or revision; no scheduler/expiry sweep is needed. Settlement and arbitration remain possible after the deadline. Existing evidence late flags and event timestamps are immutable. System-clock correctness is an operator assumption, not an externally verified time service.

## Exact Python contract — `challenges/store.py`

`DomainError(code:str,message:str,status:int)` exposes `.code`, `.message` and `.status`; `str(error)` is its safe message. Codes are `invalid_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409), and `limit` (409). `Store(data_dir:Path, clock:Callable[[],float]=time.time)` accepts clock seconds and uses `challenges.sqlite3`. Return ordinary detached JSON-compatible dictionaries. An RLock and SQLite `BEGIN IMMEDIATE` transactions protect every read/modify/write; separate Store connections must serialize competing claims/consents. Within each mutation authenticate, capture time, check role/revision/proposal identity/state/deadline/quota, then persist state/capability changes and its event atomically. Errors roll back all domain changes. SQLite records include private schema/version/digests; validate them before use. No callbacks into HTTP/UI modules. `close()` is idempotent; all later operations reject cleanly with a safe RuntimeError instead of using a closed connection.

```py
create(payload) -> Creation                  # {name, terms}
join(challenge_id, payload) -> Claim          # {inviteToken, name}; opponent seat
join_arbiter(challenge_id, payload) -> Claim  # {inviteToken, name}
get(challenge_id, token) -> Snapshot
command(challenge_id, token, action, payload) -> Snapshot | Invitation
export(challenge_id, token) -> ChallengeExport
close() -> None
```

`action` is exactly the POST route suffix in the HTTP table: `terms`, `invite`, `accept`, `decline`, `withdraw`, `evidence`, `result`, `result/respond`, `void`, `void/confirm`, `arbiter/nominate`, `arbiter/respond`, `arbiter/withdraw`, or `arbiter/decide`. `payload` is the exact table body including revision. `invite` returns Invitation; every other command returns Snapshot. Creation/claims do not pass through `command`. Validate these public Store inputs as strictly as HTTP inputs so direct calls cannot bypass quotas/roles/shapes.

Invalid/missing seat capability or unknown challenge on a member request → 401, consistently. Unknown/consumed/mismatched invitation → 404. Valid credential with forbidden role → 403. Stale revisions, unavailable states/seats, deadline-closed acceptance and quotas → 409; malformed values → 400. HTTP oversize → 413. Responses never reflect rejected tokens or source text. No raw token is recoverable from the database; the initial creation/claim/issue response is its only server disclosure.

## HTTP contract — `challenges/server.py` and CLI

`create_server(data_dir:Path, port:int=8767, *, dist_dir:Path|None=None, now=None)->ChallengeServer`, exposing normal HTTP server lifecycle and `.server_port`. A test-only `now` override is passed as Store's `clock`; default is real time. CLI `python -m challenges --data-dir PATH --port N`. Bind loopback, acquire lifetime POSIX data-directory flock before opening SQLite, and release only after in-flight handlers finish and Store closes. Use bounded handler admission (16 concurrent connections), 5-second socket inactivity timeout and 15-second whole-body deadline. Clean SIGTERM shuts down admission/handlers and releases the lock; another process must not open a still-running service's directory. No job directories, uploads or recursive cleanup. Use generated fixed database/lock names and reject symlink data/lock/database paths at startup. Do not claim protection against a malicious same-OS-user changing SQLite files.

Strict Host is exactly `127.0.0.1:PORT` or `localhost:PORT`; if Origin is present it must exactly match `http://` plus that Host. Reject duplicate Host/Origin/Authorization, cross-site Sec-Fetch-Site, transfer encoding, duplicate/invalid Content-Length, unsupported methods/content types and oversized bodies before parsing. All member API access uses `Authorization: Bearer TOKEN`; no cookie authentication, CORS or tokens in paths/query. GET status can expose version/limits but no challenge directory. Disable request-path/body/header logging. Static responses use self-only CSP, nosniff, no-referrer and no-store; API errors are bounded JSON `{error:string,code:string}` without tracebacks; HTTP oversized responses use `too_large` (413), overload uses `busy` (503), body timeouts use `timeout` (408), and unexpected failures use `internal_error` (500). The complete code set is `invalid_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `limit`, `too_large`, `timeout`, `busy`, `internal_error`; unknown internal errors map to a generic safe `internal_error` response.

All command bodies have exactly the listed fields. `R` means required `revision:number` in the JSON body. Successful snapshot commands return **200 Snapshot**; no envelope. Creation returns **201 Creation**; claim returns **200 Claim**; invitation returns **200 Invitation**. No command returns a token except creation/claim/invitation.

| Method/path | JSON body / response |
|---|---|
| GET `/api/status` | `{schemaVersion:1,maxChallenges:20}` |
| POST `/api/challenges` | `{name,terms}` |
| POST `/api/challenges/ID/join` | `{inviteToken,name}`; opponent claim, no bearer required |
| POST `/api/challenges/ID/arbiter/join` | `{inviteToken,name}`; arbiter claim, no bearer required |
| GET `/api/challenges/ID` | Snapshot; bearer required |
| POST `/api/challenges/ID/terms` | `{R,terms}` |
| POST `/api/challenges/ID/invite` | `{R,seat}` |
| POST `/api/challenges/ID/accept` | `{R,termsVersion}` |
| POST `/api/challenges/ID/decline` or `/withdraw` | `{R,reason}` |
| POST `/api/challenges/ID/evidence` | `{R,text,url}` |
| POST `/api/challenges/ID/result` | `{R,outcome,reason}` |
| POST `/api/challenges/ID/result/respond` | `{R,proposalId,accept,reason}` |
| POST `/api/challenges/ID/void` | `{R,reason}` |
| POST `/api/challenges/ID/void/confirm` | `{R,proposalId}` |
| POST `/api/challenges/ID/arbiter/nominate` | `{R,name,reason}` |
| POST `/api/challenges/ID/arbiter/respond` | `{R,nominationId,accept,reason}` |
| POST `/api/challenges/ID/arbiter/withdraw` | `{R,nominationId,reason}` |
| POST `/api/challenges/ID/arbiter/decide` | `{R,outcome,reason}` |
| GET `/api/challenges/ID/export` | ChallengeExport attachment `friendly-challenge-ID.json` |

Serve only `/`, exact `/?challenge=ID`, and bounded known built asset paths; HEAD supports static/status only. API query strings and other root queries are rejected. Initial links use `/?challenge=ID#invite=TOKEN`, `#arbiter=TOKEN` or `#access=TOKEN`; fragment is captured then removed immediately. Assets cannot escape dist via encoded traversal or symlinks. IDs/paths are fixed patterns, never free filesystem paths.

## Client integration and parallel contracts

Client owner supplies `src/types.ts`, `src/api.ts`, `src/session.ts` and unit tests. Export `ApiError extends Error { status:number; code:string }` and `request<T>(method:string,path:string,body?:unknown,token?:string,signal?:AbortSignal):Promise<T>`: same-origin only, JSON serialization, bearer only when provided, no-store, bounded error text, reject malformed/error responses and preserve AbortError. Validate the finite server error-code set (domain codes plus `too_large`, `timeout`, `busy`, and `internal_error`); malformed/unknown error responses become a generic `ApiError` with code `internal_error` and the HTTP status. Never log bodies/tokens. UI uses exact routes above; server remains authoritative for shape/permission validation.

`session.ts` exports `readLink(location:{search:string;hash:string}):{challengeId:string;kind:'invite'|'arbiter'|'access';token:string}|null`, `loadSessions():Record<string,string>`, `saveSession(challengeId:string,token:string):void`, `removeSession(challengeId:string):void`. Use localStorage key `friendly-challenges.sessions.v1`; strict bounded map of at most20 valid ID/token pairs, no other seats' credentials. Invalid stored maps are surfaced, not silently rewritten. Storage/security/quota failures throw actionable errors; UI keeps its own credential in memory and offers explicit private-link copying. Link parsing accepts only exact supported query/fragment syntax, never partially accepts duplicates/extras. Root/UI removes all fragments even on invalid input. Test helpers may inject ordinary browser globals; no production test-only auth path.

UI owner implements create/claim, editable proposed terms, explicit accept/decline/withdraw, shared evidence/feed, result proposal/confirmation/dispute, durable void offer, arbiter consent/claim/decision, reopen and authenticated export. Primary labels: **Propose challenge**, **Claim opponent seat**, **Accept these terms**, **Add evidence**, **Propose result**, **Agree with result**, **Dispute result**, **Offer to void**, **Agree and void**, **Nominate arbiter**, **Approve arbiter**, **Withdraw nomination**, **Claim arbiter seat**, **Record decision**, **Export record**, **My private access link**. Show selected role, unverified names/evidence, UTC deadline plus local display, late flags, quotas, authoritative status/revision, and terminal reasons. Confirmation screens name reviewed terms/proposal and warn that final settlement is irreversible.

Same-browser foreign access/invite links never silently replace an existing seat. Show explicit switch/claim intent; recommend independent profiles for the two parties/arbiter. Capture request generation and selected credential; ignore aborted, stale/out-of-order results. A refresh conflict keeps typed drafts, shows changed state and requires new explicit consent. Polls do not erase focus or unsent evidence/reasons. Pending consent actions are not automatically replayed after reconnect. Server capabilities are not editable browser-local profile state; no undo rewinds agreement/feed. Exports are records, not credential recovery or server-import backups. No automatic default autosave creates a challenge on page load.

Implementation ownership: git_history_review owns `challenges/store.py` and domain tests; git_reader owns HTTP/CLI/init and HTTP tests; recorder owns TS types/API/session/tests; next_project_assessment owns UI/styles; git_runner owns real production browser acceptance and fixture; root owns package/config/docs/CI/catalog/Git and integration. No cross-app imports or shared mutable framework extraction. Independent security/state review happens after implementation.

## Acceptance and stopping point

Test first with real SQLite, two independent Store connections, loopback HTTP on ephemeral ports, and production Chromium at4250. No mocked browser server for core acceptance. Required evidence:

1. Create → second-context claim → inspect/edit-before-accept → stale acceptance409 → explicit refreshed acceptance; neither invitation nor proposer bearer can accept as opponent. Duplicate concurrent claims yield exactly one seat; tokens are distinct and only hashes reach disk.
2. Accepted terms immutable; exact-deadline acceptance rejected; no clock tick manufactures status/revision/winner. Evidence before/at/after deadline has truthful immutable flags. Append-only corrections, escaping, safe-link rejection, count/byte caps and failed-command atomicity.
3. Result proposer cannot self-confirm; opposite party can agree or dispute; stale proposal IDs and concurrent result/void/arbiter decisions cannot settle twice. All terminal commands reject without feed change. Fresh offers cannot bypass quotas, and mutual void remains available at all other limits.
4. Arbiter invite unavailable before mutual same-nomination consent; no guessed/read-only/name-based elevation. Withdrawal/reissue invalidates old token; concurrent withdrawal/claim has one serialized winner. Third context claims once, sees authorized record, cannot act as a party, and can decide only a live dispute. No unilateral post-claim replacement.
5. Restart/reopen preserve consent, evidence, capabilities and audit. Export contains exact recorded data with no raw capabilities, digests or private keys. Cross-challenge tokens and unrelated invitation types fail. Corrupt DB startup/read errors do not erase records.
6. Host/Origin/auth/path/JSON attacks fail; duplicate keys/headers, source URLs, body timeout, overload and shutdown locking verified. No external page/asset requests during ordinary app flow. Static room links actually load the production app.
7. Browser drafts/focus survive polling409/reconnect; same-profile foreign links require explicit choice; fragments are removed; storage failure retains in-memory use and private-link recovery. Run desktop/mobile usable layout and keyboard checks, real two-party resolution plus independent three-party arbitration, downloaded JSON inspection, and service restart.

Run full Python unittest/compile/Ruff, TypeScript unit/lint/typecheck/build and production browser suites. Record actual platform/browser limitations. Once the complete local agreement-to-resolution flow passes independent review, mark maintenance. Internet hosting, arbitrary evidence uploads, broad social graphs, richer negotiation and verified identities are future work, not unfinished claims hidden in this milestone.
