# Duet: opt-in operator-configured HTTPS/LAN transport (#107)

Root-approved frozen contract; implement and verify within the ownership boundaries below. Tracker: https://github.com/twangyal/projects-monorepo/issues/107.

## Product scope

Let an operator run the existing two-seat music room at one explicitly configured HTTPS address on a private IPv4 LAN. The host creates a room with an operator setup key, shares the existing one-use invitation, and both participants use their own private capability and explicit audio consent. Upload, independent ratings, mix ordering, shared playback, dated memories, recovery links and complete offline archives keep their current semantics.

Default `python3 -m duet --data-dir ... --port 8766` remains HTTP on 127.0.0.1, including current loopback Host aliases, creation without a setup key and cookie behavior. HTTPS is an all-or-nothing opt-in. No internet hosting, discovery, certificate generation, reverse proxies, Spotify, accounts, network inference or new room schema. Existing Linux/procfs/FFmpeg requirements remain. Software acceptance does not establish physical two-device playback or arbitrary network latency.

## Configuration and public Python seam

New `duet/transport.py` owns configuration, shared limits and setup-key comparison. Freeze these exports:

```python
class TransportError(ValueError):
    # Inherited constructor(message: str); only fixed actionable messages.
    pass

@dataclass(frozen=True)
class TransportConfig:
    bind: str
    port: int
    origin: str
    authority: str
    ssl_context: ssl.SSLContext  # repr=False, compare=False
    setup_digest: bytes         # repr=False; SHA256 of the 64 ASCII key bytes

def prepare_transport(*, bind: str, port: int, origin: str,
                      tls_cert: Path, tls_key: Path,
                      setup_token_file: Path) -> TransportConfig: ...

def matches_setup(config: TransportConfig, token: object) -> bool: ...
```

`prepare_transport` fully validates and loads TLS/key material before any library directory creation, lifetime-lock acquisition, Store construction, startup pause or listener binding. It does not modify those input files. `matches_setup` returns false for malformed values and otherwise compares SHA256 digests with `hmac.compare_digest`; it never exposes raw key/digest values. The prepared SSLContext is an internal trusted runtime object, not an imported user document. The server independently rejects an incompatible config type, port or origin/bind pairing before library mutation.

Extend, without changing existing positional arguments:

```python
create_server(data_dir: Path, port: int = 8766, *,
              dist_dir: Path | None = None, normalize=None,
              transport: TransportConfig | None = None) -> DuetServer
```

`DuetServer.__init__(data_dir, port, dist_dir, normalize, *, transport=None)` consumes the same configuration. None selects the existing HTTP loopback behavior. HTTPS port must exactly equal config.port. Do not introduce an origin mutation setter or test-only bypass. HTTPS tests reserve an available nonzero port, then start the actual server normally.

CLI adds `--bind`, `--origin`, `--tls-cert`, `--tls-key`, `--setup-token-file`; supplying any requires all five. Omitted options retain default loopback. `--port` is unchanged for HTTP (0 allowed for library test callers); HTTPS requires an integer 1–65535. CLI catches configuration errors without tracebacks and emits bounded messages that contain no key, certificate contents or filesystem paths. Startup prints only the public origin, never participant or setup links.

## Exact address and file admission

- Bind is a canonical decimal IPv4 literal: four octets, no leading zeros, whitespace, DNS resolution or aliases. Allow only 10/8, 172.16/12, 192.168/16 or 127/8. Reject unspecified/wildcard, public/global, link-local, multicast, all-ones broadcast, IPv6 and zone forms. Do not guess directed-broadcast subnet boundaries from an address suffix; interface configuration remains the operator’s responsibility. Operator selects a specific address; the service does not enumerate or automatically choose interfaces. This address restriction is not a firewall or proof of the caller's network provenance.
- Origin is a canonical lowercase ASCII `https://authority` spelling, at most 253 hostname bytes plus the scheme/port. No whitespace, Unicode/IDNA conversion, trailing dot, userinfo, percent escapes, path (including `/`), query or fragment. Host is either the same canonical IPv4 literal as bind, or DNS labels 1–63 characters of `[a-z0-9-]`, alphanumeric at each end, total at most 253 characters. Numeric-looking noncanonical IPv4 forms reject instead of becoming DNS labels. Hostname resolution and certificate SAN/trust configuration are operator responsibilities; the service does not perform external DNS probes.
- If port is 443, origin omits the port (`https://host`); redundant `:443` rejects. Other ports require canonical decimal `:port`, exactly equal to the selected service port. `authority` is the exact resulting Host field spelling.
- Certificate at most 128 KiB; private key at most 32 KiB. Setup key at most 65 bytes and exactly 64 lowercase hexadecimal ASCII characters plus at most one trailing LF. No BOM, CR, spaces or empty files.
- Open each file regular and NOFOLLOW/nonblocking; validate type, declared size and actual bounded reads. Key and setup files must be owned by the effective service UID and have exactly permission bits 0600 (reject set-ID/sticky or other access bits). Certificate can be normally readable. Never follow a final symlink or reopen a validated input through a rebound pathname. Load the pinned certificate/key FDs through the existing Linux procfs capability where needed; reject malformed/encrypted keys rather than prompting interactively. Close all configuration FDs on success/failure.
- Context is `ssl.PROTOCOL_TLS_SERVER`, minimum TLS 1.2; advertise only HTTP/1.1 if ALPN is configured. No client certificate requirement, SSLv3 fallback or production client verification override. Loading a key pair does not claim that browsers trust its certificate, SAN, expiry or chain. Configuration failure occurs before the original library is touched. For HTTPS, bind/listen admission must also fail before Store construction or startup pause, so an unavailable interface/occupied port does not mutate saved room state. Do not perform reverse-DNS lookup as a side effect of HTTPServer.server_bind; use the configured host and actual bound port.

## Bounded connection and request lifecycle

Freeze shared constants in `transport.py`:

```python
MAX_CONNECTIONS = 16
LISTEN_BACKLOG = 16
TLS_HANDSHAKE_SECONDS = 5.0
HEADER_SECONDS = 10.0
MAX_HEADER_BYTES = 16 * 1024
MAX_HEADER_FIELDS = 64
SOCKET_IDLE_SECONDS = 5.0
BODY_SECONDS = 30.0
RESPONSE_SECONDS = 30.0
CONNECTION_SECONDS = 75.0
REQUEST_JOIN_SECONDS = 5.0
MAX_CERT_BYTES = 128 * 1024
MAX_KEY_BYTES = 32 * 1024
MAX_SETUP_BYTES = 65
```

HTTPS runtime lives in new `duet/https_server.py`, consumed only by the server owner. Its internal mechanisms need not become public producer seams; `TransportConfig` and the constructor above are the cross-owner interfaces.

1. Accept a raw socket, claim one of 16 slots before spawning a worker or constructing SSL state. No waiting socket queue in Python and no per-connection unbounded helper threads. Saturation closes the new socket without a TLS/HTTP response. Bound kernel listen backlog to 16. Released slots are reusable.
2. Start the total 75-second monotonic deadline at acceptance. TLS wrapping uses `do_handshake_on_connect=False`; handshake runs in the admitted worker, never the accept loop. Enforce 5 seconds absolute plus 5 seconds inactivity, check monotonic expiry after success and refuse expired handshakes before the handler starts. Malformed/failed handshakes receive no cleartext HTTP error.
3. HTTP header deadline starts after the completed handshake. Count only the returned request-line bytes, field lines and final CRLF toward 16 KiB; do not count body bytes merely prefetched by BufferedReader; accept at most 64 fields, including duplicates before their security rejection. Enforce limits before unbounded line allocation. Header deadline checks belong below `BufferedReader.readline`, plus owned-socket deadline closure: setting one inactivity timeout before a trickled line is insufficient. Require ordinary HTTP/1.0 or HTTP/1.1, reject absolute-form/CONNECT/upgrade and unsupported Expect requests; no interim body admission before security.
4. Serve one HTTP request per connection, always Connection: close; never process buffered pipelined requests. Existing 30-second absolute body admission remains and is capped by the total connection deadline. Keep 5-second inactivity and bounded block reads. Mutation/auth/framing admission must precede body reads, upload reservation or store changes.
5. Begin a 30-second response deadline when emitting the response, capped by total expiry. Bound every write and file-stream stage, including actual 8 MiB audio Range responses. Timeout after headers closes the socket rather than appending a JSON body to media. No extra stream worker or whole-media allocation.
6. A bounded supervisor/watchdog closes the exact owned raw/SSL socket at absolute expiry, including while SSL, BufferedReader or writes are blocked. Use one bounded watchdog or equivalent finite mechanism, not one persistent timer/thread per packet. Replacing a raw socket with its SSL wrapper preserves the same slot/deadline/ownership. Retired callbacks cannot close a newer socket or release its slot. Worker cleanup closes each owned socket and releases its slot exactly once.
7. Shutdown stops admission, closes listener and all admitted sockets, signals receiving-upload/conversion cancellation, and joins request workers and the existing media worker before Store.close and lifetime-lock release. Request join bound is 5 seconds; retain the existing media cancellation/join bound. If any worker remains, refuse final teardown while preserving Store/data-lock ownership; never release the directory for another process to clean an active worker. Repeated close can finish teardown after workers exit. Test SIGTERM with handshake, header/body, download and normalization pending.

These new network bounds apply to opt-in HTTPS. Default loopback remains compatible. Existing source/media/room/job limits do not increase: five rooms, two seats, twelve tracks per room, 100 memories per room, 25 MiB source upload, 64 KiB JSON, 8 MiB stored Opus, one active conversion, 45-second/512-MiB media worker and 50 job statuses.

## HTTPS security and creation authority

- HTTPS accepts exactly one Host equal to config.authority. A supplied Origin must exactly equal config.origin; duplicate Origin rejects. POST/PUT/DELETE require exactly one Origin in HTTPS mode, including room creation/join/access/upload/cancel. GET/HEAD may omit Origin for native same-origin media; any supplied mismatch rejects. Preserve current loopback Origin rules.
- Reject duplicate Sec-Fetch-Site and any value `cross-site`; no CORS or OPTIONS authorization bypass. Reject Forwarded and X-Forwarded-* in HTTPS mode rather than treating them as identity/origin authority. Do not trust Referer, TLS SNI as HTTP Host replacement or proxy headers. Fixed errors contain no supplied credentials/origins.
- Preserve existing token-free `/?room=<id>` GET/HEAD exception; all other queries/fragments, encoded traversal or unknown routes retain rejection. Bearer capabilities stay exactly 64 lowercase hex and room-scoped. Audio-only cookie fallback remains; JSON reads/mutations never become cookie-authorized.
- Reject duplicate Content-Type for request bodies, duplicate Cookie where cookie authentication is used, duplicate Authorization and all Transfer-Encoding. GET/HEAD reject nonzero Content-Length or Transfer-Encoding without reading a body. HTTPS headers with controls/malformed names are rejected before routing. Current exact length/JSON-key/fatal-UTF8/nonfinite admission remains; no permissive repair.
- HTTPS media cookies add Secure to current HttpOnly, SameSite=Strict and room-scoped Path. HTTP default does not add Secure. Keep Cache-Control: no-store, Referrer-Policy: no-referrer, current CSP and no access logs. Do not add a credential-bearing redirect or mixed-content fallback.
- Only HTTPS POST `/api/rooms` additionally requires exactly one `X-Duet-Setup-Key` header matching the configured setup digest. Reject absent/malformed/duplicate/incorrect keys before body reading or room allocation. Supplying this key does not authorize any existing room, seat, audio or invite operation. Do not accept it in query, cookie, JSON or Authorization. Do not expose or persist the key/digest; restart rereads the operator-owned file.
- HTTPS `/api/status` adds `transport: {mode: 'https-lan', origin: config.origin, setupRequired: true}` to existing limits/version. Default status adds `transport: {mode: 'http-loopback', origin: 'http://127.0.0.1:<port>', setupRequired: false}`; existing status consumers/tests must tolerate this additive field. No paths, key identifiers, seat IDs or TLS material in status.

## Client flow and literal controls

Keep stable existing room/editor/player DOM, capability handling, upload cancellation and generation checks. Client fetches same-origin status to disclose mode; failure gives an actionable retry and leaves room creation disabled until its authority requirement is known. Existing recovered-seat/invitation flows do not require the setup key and remain independently usable.

New stable `#transport-status` polite text identifies HTTP loopback or configured HTTPS origin and explains that the other device must reach this address and trust its certificate. Keep physical-test coverage/limitations in the README and evidence rather than placing engineering verification details in the product flow. `#setup-key-field` contains password `#setup-key`, label **Operator setup key**, autocomplete off, spellcheck false, maxLength 64 and no form name. Visible/required only for HTTPS room creation. It is a creation-only field: never saved, echoed, copied into an invitation or used as participant authority. Read/check syntax when Create our room is deliberately submitted; copy into that one request header and clear the DOM value immediately when the request is dispatched, including later failures. Also clear this field on pagehide and when leaving room creation. Do not introduce an unsaved-draft leave prompt solely for a submitted identity/setup form. No automatic retry/replay of create or any mutation; lost response explains uncertainty. A failed create can require re-entry and explicit retry.

Private invitation/access URLs already derive from location.href; retain this after exact server origin admission. Links use fragments, which readLocation strips before requests. Keep share panels explicit with Close link and existing draft guards. Origin changes do not migrate localStorage seats; instruct each participant to use their separately retained own access link with only its origin changed. Do not invent new seats or import another participant's authority.

Preserve explicit Enable audio on this device and current native playback/350 ms reconciliation. HTTPS support does not promise latency independent of network or physical output hardware. No certificate-trust bypass in UI, production scripts or launcher.

## Verification, ownership and release

Producer partitions (root assigns agent names):

1. Configuration/server owner (`audio_engine`): `duet/transport.py`, `duet/https_server.py`, `duet/server.py`, new `tests/test_transport_config.py` and `tests/test_https_server.py`; sole owner of configuration, bounded sockets/deadlines/shutdown and route authority. Publish the frozen callable interfaces first. Existing test edits remain under root compatibility coordination.
2. CLI/UI owner (`recorder`): `duet/__main__.py`, new `tests/test_cli_https.py`, `src/main.ts`, `index.html`, `src/style.css` if needed and scoped UI tests. Import the frozen configuration seam; no transport/server or audio-sync algorithm edits.
3. Independent protocol owner (`git_history_review`): new `tests/test_https_oracle.py` and unique test-only certificate/fixture helper; original literal requests/negative cases before producer reads. Real TLS sockets and trusted CA clients, not fake TLS objects.
4. Independent native owner (`git_reader`, after completing Karaoke CI receipt): new `tests/browser/https-lan.spec.ts` and uniquely named test-only service helper. Real service, original normalized audio and two browser contexts; root schedules production builds/runtime.
5. Final reviewer (`next_project_assessment`): read-only cross-seam review after producers freeze; report findings to file owners. Root owns package/config/docs/catalog/version/Git/GitHub, compatible old-test edits and live runtime scheduling. No production globals, ignored certificate errors or fake media as acceptance substitutes.

Strict Python SSL clients trust only an original test CA and verify hostname/chain; negatives cover unknown CA, wrong SAN, expired certificate, wrong authority, plaintext and malformed TLS. Native Chromium should use normal locally installed test trust if feasible; otherwise an explicit narrowly scoped test-only `--ignore-certificate-errors-spki-list=<fixture SPKI>` is acceptable with original exact certificate/fingerprint evidence, never blanket ignoreHTTPSErrors/ignore-certificate-errors and never production use. Record this fixture boundary; Python verification still proves actual trust failures. Do not archive private setup/seat/certificate-key values.

Network tests establish 16 admitted slots, saturation/recovery, trickled TLS/one-line headers, exact header byte/field bounds, idle and absolute deadlines, one-request pipeline behavior, body/upload/range stream limits and teardown/no premature library ownership release. Keep time-budget tests honest: injected timing branch tests are distinct from measured real socket deadlines. Test actual config rejects before existing DB/files/raw playback anchors are touched. Verify setup-only creation, one-use invitation, both independent capabilities, wrong room/seat, cookie Secure/Path and exact original audio ranges.

Native acceptance creates a room with setup key, clears it immediately, joins from another isolated browser context, rates/builds/reorders a mix, listens to genuine normalized audio with explicit consent, seeks/pauses and adds a dated memory. Reload/restart and private links recover each original seat; unauthorized callers cannot consume room quota or read audio. Capture actual service/media bytes and source hashes, with secrets excluded. Retain current loopback full unit/browser/archive tests. A loopback test SAN validates HTTPS behavior; where a real private interface exists, also prove an actual bind/request through that interface without calling it two-device physical evidence.

Manual later acceptance requires two actual devices on the intended LAN, their normally trusted certificates, original participant links, consent and measured playback/reconnect behavior. Software completion can close this bounded transport milestone with that limitation explicit; do not claim physical-device/browser compatibility or internet deployment. Local checks and exact-source CI must pass before root closes #107.
