# Friendly Challenges: opt-in trusted-LAN HTTPS (#108)

Approved implementation contract. Tracker: https://github.com/twangyal/projects-monorepo/issues/108.

## Useful scope and invariants

Make the existing private challenge notebook reachable at one operator-configured HTTPS address on a private IPv4 LAN. The operator authorizes creation, the proposer shares an opponent invitation, claiming does not mean accepting, both parties review exact current terms, and a mutually appointed third seat can arbitrate. Retain reviewed private image evidence, complete public image exports and offline library recovery. No internet deployment, reverse proxy, discovery, certificate generation, new account system or remote model.

Default `python -m challenges --data-dir ... --port 8767` remains HTTP bound to 127.0.0.1. Preserve existing loopback aliases, public creation, 16-slot admission/503 behavior, 15-second header/body bounds and 20-second shutdown join. New stricter HTTPS admission applies only when explicitly configured. The optional HTTPS implementation requires Linux memfd/procfs support; existing POSIX loopback support is not narrowed. No domain/state/audit/private-record/SQLite/archive schema change, credential reminting, automatic image upload, consent replay or startup rewrite of old records.

Existing limits stay authoritative: 20 challenges, three possible seats, 40 append-only evidence entries/eight images per challenge, normalized JPEG at most 512 KiB/1024 pixels per side, 16 KiB JSON request, 1 MiB JSON response, image-body `16 + 16 KiB + 512 KiB` bytes, 8 MiB static file, and 12 MiB complete image HTML export. Source-photo normalization remains 8 MiB/16 MP, actual Pillow server admission, and exact reviewed JPEG bytes. TLS does not authenticate identities or evidence; hashes identify retained bytes only.

## Isolated configuration and frozen API

Use new app-local `challenges/transport.py` and `challenges/https_server.py`, adapting the coherent Duet #107 modules. Do not import Duet at runtime or create monorepo-wide transport infrastructure. Retain actual verified corrections: numeric origin aliases reject, header counts exclude prefetched body bytes, request joins precede any Store lock acquisition, TCP bind retains reuse-address without reverse DNS, and HTTPS bind failures receive sanitized CLI guidance.

Configuration exports in `challenges/transport.py`:

```python
class TransportError(ValueError):
    pass  # inherited constructor(message: str), fixed actionable messages only

@dataclass(frozen=True)
class TransportConfig:
    bind: str
    port: int
    origin: str
    authority: str
    ssl_context: ssl.SSLContext  # repr=False, compare=False
    setup_digest: bytes         # repr=False, exactly SHA256 of the 64 ASCII key bytes

def prepare_transport(*, bind: str, port: int, origin: str,
                      tls_cert: Path, tls_key: Path,
                      setup_token_file: Path) -> TransportConfig: ...
def validate_transport(config: object, port: int) -> None: ...
def matches_setup(config: TransportConfig, token: object) -> bool: ...
```

Internal HTTPS runtime may retain Duet's `HttpsRuntime`, `Connection`, `HeaderReader`, `DeadlineWriter`, `RequestError` names within this app; these are server-owner internals. Do not expose/test private runtime fields through the product. Public constructor seam:

```python
create_server(data_dir: Path, port: int = 8767, *,
              dist_dir: Path | None = None, now=None,
              transport: TransportConfig | None = None) -> ChallengeServer
# ChallengeServer(data_dir, port, dist_dir, now, *, transport=None)
```

None is the current HTTP mode; HTTPS config.port must match the supplied nonzero port. No mutable origin setter or test-only bypass. `prepare_transport` and `validate_transport` occur before library mutation. HTTPS listener bind/listen also precede data-directory creation, flock, Store construction/schema admission. An unavailable interface/occupied port must leave an existing library's bytes, audit and schema untouched. Library initialization failure closes the already bound listener and any acquired owned resources. Calling `TCPServer.server_bind` preserves actual SO_REUSEADDR policy and avoids HTTPServer reverse DNS; set configured server_name/actual server_port afterward. Verify immediate same-address clean restart after an actual TLS request.

CLI adds `--bind`, `--origin`, `--tls-cert`, `--tls-key`, `--setup-token-file`; any supplied means all five are required. HTTP retains port 0 for existing tests; HTTPS requires integer 1–65535. CLI performs preparation before create_server and prints only the public origin. Fixed bounded TransportError/HTTPS OSError guidance contains no credential, certificate material, key/file path or traceback. Existing HTTP exception behavior remains unchanged.

## Exact address, origin and TLS files

- Canonical decimal IPv4 bind, with no whitespace or leading zeros; allow only explicit RFC1918 10/8, 172.16/12, 192.168/16 or 127/8. Do not use broad ipaddress.is_private, DNS bind resolution or interface discovery. Reject wildcard/unspecified, public/global, link-local, multicast, all-ones broadcast and IPv6. Do not infer directed-broadcast masks from a last octet; operator selects a valid interface address. Binding privately is not a firewall or proof of caller location.
- Origin exactly lowercase ASCII `https://authority`, at most 267 characters. Host at most 253 characters: canonical IPv4 equal to bind, or DNS labels 1–63 characters, `[a-z0-9-]`, alphanumeric ends, no empty label/trailing dot. Reject numeric-looking IPv4 aliases, including a numeric/hex final label, rather than silently accepting browser URL canonicalization. No userinfo, path (including `/`), query, fragment, percent syntax, Unicode/IDNA conversion or whitespace.
- Port 443 uses `https://host` with no explicit port; redundant `:443` rejects. Other ports require exact canonical decimal `:port` matching the listener. `authority` is the exact admitted Host spelling. Operators configure DNS and certificate SAN/trust; no external resolution probe or proxy-origin trust.
- Cert at most 128 KiB; key at most 32 KiB; setup file at most 65 bytes, exactly 64 lowercase hexadecimal ASCII bytes with one optional trailing LF. NOFOLLOW/nonblocking regular-file opens, declared and actual bounded lengths and stable fstat checks. Key/setup owned by effective UID with exactly 0600 permission bits. No encrypted-key prompt. Load copied admitted bytes via owned Linux memfd/procfs capabilities, not by reopening a rebound input pathname; close every FD on failure/success.
- SSLContext is PROTOCOL_TLS_SERVER, minimum TLS 1.2, HTTP/1.1-only ALPN if advertised. Loading the matching pair does not prove browser trust, SAN, expiry or chain. No production ignore-certificate-errors, fallback HTTP listener, automatic certificate download or token-bearing redirect.
- matches_setup rejects malformed values and compares SHA256 digests with constant-time hmac.compare_digest. No raw key/digest field in logs/status/records/exports/archive. These trusted in-process configuration objects are not imported user records.

The optional HTTPS mode requires Linux memfd and `/proc/self/fd` support for this admitted-byte TLS loading design. Document that requirement separately from the existing POSIX HTTP mode; unsupported HTTPS startup fails before library mutation with bounded actionable guidance. Do not install a certificate authority or add a pathname-reopen fallback.

## HTTPS connection, body and store lifecycle

Freeze constants in transport.py (Friendly's existing HTTP constants remain unchanged):

```python
MAX_CONNECTIONS = 16
LISTEN_BACKLOG = 16
TLS_HANDSHAKE_SECONDS = 5.0
HEADER_SECONDS = 10.0
MAX_HEADER_BYTES = 16 * 1024
MAX_HEADER_FIELDS = 64
SOCKET_IDLE_SECONDS = 5.0
BODY_SECONDS = 15.0
RESPONSE_SECONDS = 30.0
CONNECTION_SECONDS = 75.0
REQUEST_JOIN_SECONDS = 5.0
MAX_CERT_BYTES = 128 * 1024
MAX_KEY_BYTES = 32 * 1024
MAX_SETUP_BYTES = 65
```

Claim a slot for the raw accepted socket before TLS wrapping or a request worker. HTTPS uses one admission pool, not both the old HTTP pool and a second TLS pool. A saturated seventeenth socket closes without allocating another worker or sending cleartext 503; default HTTP still returns its current 503. Listen backlog is 16. Handshake runs in the admitted worker with do_handshake_on_connect=False, never accept loop. Total deadline starts at acceptance; handshake deadline is five seconds and checked after success before HTTP handler admission.

One bounded watchdog closes exact owned raw/SSL sockets on absolute expiry, including while native handshake/read/write blocks. Raw-to-SSL handoff preserves ownership/slot/deadlines; no blocking unwrap or old callback closing a newer connection. One request then Connection: close; no pipelined second mutation. All deadlines are monotonic and include buffered-data checks, not only socket inactivity.

Headers have ten seconds absolute, five seconds inactivity, 16 KiB including request line/field lines/final CRLF, and 64 fields before duplicate rejection. Count only syntax consumed, not body bytes prefetched by BufferedReader. Bound lines before allocation and check below buffered readline so a continuously trickled line cannot extend the deadline. Require HTTP/1.0 or 1.1 origin-form requests; reject absolute-form, CONNECT, upgrade, folded/control/malformed headers and unsupported Expect without interim body acceptance.

Bodies keep Friendly's fifteen-second absolute limit and existing route-specific size/content-type admission, capped by total expiry. No increase to photo/image/JSON sizes. Setup/auth/framing checks precede body reads or Store mutation. Existing image route authenticates via Store.get before reading its larger bounded body, and Store.add_image reauthenticates/rechecks revision in its atomic transaction after independent JPEG decode; preserve this sequence. No Store method, decoder semantics or audit event changes.

Responses have thirty seconds absolute from first headers, capped by total expiry; all actual writes/static blocks/JPEG/JSON/full HTML downloads check this budget and socket inactivity. Preserve 1 MiB JSON/12 MiB HTML bounds and existing full-byte image/header/hash contract. Record response-started state: an error after headers closes the owned connection, never appends JSON to a partial JPEG/HTML response. Successful authoritative commands may have committed before a response is lost/cancelled; never promise rollback or automatically replay agreement/evidence mutations.

Shutdown first prevents new admission and closes listener/owned sockets, then joins request workers within five seconds BEFORE Store.close or any acquisition of Store's RLock. Friendly has no media-job thread to close. A handler can be executing SQLite or bounded Pillow/render work even after socket close; if it remains, refuse teardown and keep Store/flock owned. Repeated close can finish after it exits. This prevents a second process taking the library while an authorized command is still active; it does not kill Python/Pillow code or guarantee cancellation rollback. Default HTTP keeps its existing twenty-second request join. Test held Store lock, pending header/body/image response and SIGTERM plus subsequent real restart.

## Request authority and private images

HTTPS accepts exactly one Host=config.authority and at most one exact Origin=config.origin; every POST requires that Origin. GET/HEAD may omit Origin, but supplied mismatch rejects. Reject duplicate Sec-Fetch-Site/cross-site, Forwarded/X-Forwarded-*, all Transfer-Encoding, duplicate Authorization/Content-Length/Content-Type, GET/HEAD nonzero Content-Length, Expect/Upgrade. No CORS or OPTIONS bypass. Preserve Friendly's supported method set (GET, HEAD, POST), error envelope `{error,code}` and existing error codes. No new domain action authorizations.

Only POST `/api/challenges` additionally requires exactly one `X-Friendly-Setup-Key`, matching configured digest. Reject invalid/missing/duplicate key before body reading or challenge allocation. It authorizes creation only, never access/acceptance/opponent or arbiter claim. Do not accept setup authority in JSON/cookies/query/Authorization. No cookies at all: existing private JSON, retained JPEG and image HTML routes remain Bearer-only, and client binary/JSON requests retain credentials:'omit', redirect:'error', no retries and same-origin paths. Even a cookie containing a valid capability grants no authority. The service never turns an image URL public or puts a token in its URL.

Preserve exact `/?challenge=<id>` GET/HEAD link exception, no other query/fragment/traversal; private links carry fragments removed before requests. Status is current `{schemaVersion:1,maxChallenges:20}` plus exact `transport:{mode:'https-lan'|'http-loopback',origin:string,setupRequired:boolean}`. HTTPS origin is configured canonical spelling; HTTP status is `http://127.0.0.1:<actual-port>` including explicit :80. No secrets, certificate/file paths or challenge IDs. Keep no-store/no-referrer/nosniff/CSP, suppressed framework/request logs and script-free image export CSP.

## UI/API seam and intent safety

In `src/api.ts`, extend the existing public function compatibly:

```ts
request<T>(method: string, path: string, body?: unknown, token?: string,
           signal?: AbortSignal, setupKey?: string): Promise<T>
```

A supplied setupKey must be exact 64 lowercase hex, method POST, path `/api/challenges`, token undefined; otherwise reject before fetch. Only that dispatch adds `X-Friendly-Setup-Key`. JSON/body/error streaming validation and all binary helpers remain unchanged; no setup argument on postImageEvidence/fetchEvidenceImage/fetchImageExport. Test request helper never forwards setup authority elsewhere or persists it.

Add stable `#transport-status`, `#retry-transport-status` (**Check connection mode**), `#setup-key-field` and password `#setup-key` (**Operator setup key**, autocomplete off, spellcheck false, maxLength64, no name). Only creation is disabled while current status is unknown/error; saved access/invitations/arbiter claims, private image inspection and current-record actions remain independently usable. A status fetch has separate epoch/controller and never reconstructs forms, raw text, images or selection. HTTPS status must be exact self origin; HTTP validates frozen explicit port spelling, including :80, without pretending URL.origin preserves it.

Setup field is visible/required only on HTTPS dashboard creation. Capture syntactically valid key and clear DOM immediately at actual request dispatch, and on leaving creation/pagehide. No localStorage/sessionStorage, fragment, invitation, draft serialization, form name or hidden data attribute. Validate the complete creation payload and its 16 KiB serialized-byte admission before clearing the key or dispatching; retain the API helper's independent bounds. Invalid local terms before dispatch keep the key/draft; a dispatched failure requires explicit re-entry. No setup-only unsaved-form confirmation or incidental consent dialog.

Creation owns explicit operation identity plus generation/editor-input intent. Preserve existing successful returned seat even if newer intent/pagehide makes automatic activation unsafe; show/recover that returned private access only through current safe UI ownership. Stale success/error/finally cannot replace a newer selected challenge, reset newer terms or clear another operation's busy state. Lost response reports possible committed creation with no automatic retry. Handle pagehide/BFCache and status refresh independently. Existing claim-versus-acceptance separation, changed-back drafts, reviewed termsVersion/revision, image exact-preview review, lost-append refresh gate, private URL cleanup and irreversible audit remain intact.

## Ownership and independent acceptance

1. Transport/server owner: new challenges/transport.py, challenges/https_server.py, additive challenges/server.py; new tests/test_transport_config.py/tests/test_https_server.py. Local adaptation, no Duet edits/shared library. Publish frozen dataclass/constants/constructor signatures before consumers. No Store/domain/images/archive edits.
2. CLI/UI/API owner: challenges/__main__.py, src/api.ts/src/main.ts/src/style.css only as needed; new tests/test_cli_https.py and tests/https-api.test.ts. Sole owner of UI/status/setup dispatch and creation ownership. No types/domain/schema edits required.
3. Independent TLS oracle owner: new tests/test_https_oracle.py plus uniquely named test-only CA helper. Strict Python SSL verification with original CA/SAN, wrong chain/name/expiry negatives, actual raw TLS headers/deadlines/slots/auth/framing/shutdown/restart. Expectations authored before producer reads.
4. Independent native owner: new tests/browser/https-lan.spec.ts plus uniquely named test-only HTTPS service helper/original images. Root schedules normal build/runtime; no production globals/state injection.
5. Final read-only reviewer/root: cross-seam review after freeze; root owns docs/plan/version/config/catalog/Git/GitHub and any compatible existing-test changes. Hold implementation until root approves this document.

Use operator-provided certificates trusted normally by each intended browser/device. Verification uses an original test CA and strict Python hostname/chain checks; do not bypass trust for these oracle tests. Native Chromium can use fixture CA trust, or narrowly scoped test-only SPKI allowlisting when normal trust installation is unavailable; record exact fixture boundary, never blanket ignoreHTTPSErrors or production insecure flags. Existing Duet TLS tests are useful structural precedent but not Friendly's independent authority/consent expected values.

Native flow uses three genuine isolated contexts: proposer with setup key creates; opponent claims but has not accepted; terms revision makes stale consent fail; fresh explicit acceptance succeeds. Append one original actually normalized JPEG with reviewed exact preview, retrieve from all legitimately claimed seats with exact size/hash, and reject absent/wrong/Bearer-in-cookie authority. Dispute a result, approve the exact arbiter nomination from both parties, claim third seat and explicitly decide; creation setup key never grants any of these powers. Keep image caption/raw drafts/focus on failures and retire stale work without replay.

Download actual token-free JSON and complete HTML; independently decode embedded JPEG and compare audit/descriptor/media bytes. Full service process restart on the same port must retain all three original private seats, exact accepted terms/revisions/outcome/audit/images; used invitations stay used. Offline archive behavior is unchanged and existing complete archive tests stay green. Record certificate/source/artifact hashes without private credentials/setup keys. Retain the full existing Python/TS/browser/check/build suite, including loopback header deadlines, image maxima and original agreement consent assertions.

Real socket tests separately establish actual handshake/header/body deadlines, 16 slots and release, response budget, immediate restart and safe refusal to release a held Store lock. Clearly label injected-clock/shortened-budget branches rather than claiming full-duration wall-clock acceptance. A private-interface bind test is useful if available but not physical multi-device proof. Later manual two-device certificate setup/agreement/image checks remain explicitly unverified until actual devices are available. Software milestone completion does not claim internet hosting, distinct verified humans, evidentiary authenticity or every-browser support. Root closes #108 only after exact-source local gates and CI, with limits recorded honestly.
