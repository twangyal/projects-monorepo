# Motion Studio: immutable private snapshot links (#110)

Approved by root on 2026-10-04; implementation released. Tracker: https://github.com/twangyal/projects-monorepo/issues/110.

## Outcome and retained editor

Deliberately publish one complete committed animation to an optional operator-run service, send a private viewing link, and let its recipient play/export the captured animation or explicitly open an independent local copy. Publications never follow later editor changes. Preserve the ordinary static/offline editor, eight-project IndexedDB library, schema-1 migration, canonical schema-2 files, raw recovery, stale-tab CAS, drawing/tween history and existing render/export kernels. No account, synchronization, remote editing, public gallery, public listing, automatic upload, AI, internet deployment or promise of physical device compatibility.

The service serves the same production editor and a separate read-only snapshot view. A static Vite deployment continues to work without the service: unavailable service status disables publishing only, not drawing, local saving, imports, backups or exports. Shared viewing never silently opens, saves or replaces an editor project.

## Runtime choice and actual decoder evidence

Recommend an app-local Node 24 service. Reuse `src/model.ts::validateProject` directly instead of porting the mature cel/pose/point/quota rules to Python. Keep Node-only modules outside the browser dependency graph. Direct runtime dependency `pngjs` is pinned to 7.0.0 (MIT); its code is already available for inspection in another app, but Motion adds its own dependency and never imports another app at runtime.

Inspection found that pngjs's synchronous interlaced path uses unbounded `zlib.inflateSync`, and its noninterlaced internal inflater can stop at the expected output length. Neither is sufficient admission by itself. A bounded physical PNG/zlib preflight must precede the full pngjs decode. Isolate the complete project admission in one disposable worker; timeout terminates and awaits worker exit before its slot is reused. Worker admission does no filesystem writes.

Alternatives: a Python/Pillow service offers mature PNG decoding/flock/TLS but would require a second project validator or a Node validation subprocess; a header-only service would preserve malformed compressed images. Neither is selected. Node does require a small explicit socket/TLS lifetime layer and Linux FD/flock discipline. Do not introduce shared monorepo service infrastructure.

## Portable project and image admission

- Publish only canonical `Project` schema 2, at most **6,291,624 UTF-8 bytes**. Request body is the project itself, not a new project wrapper. The service returns canonical JSON bytes from the existing validator; review explicitly excludes unsent fields, gesture previews, tween scratch, history and library IDs.
- Existing authoritative bounds remain: 640×360, 12 fps, 12–96 frames; eight layers/four images, 24 cels and 24 pose keys per layer, 100 strokes/10,000 points, existing pose/color/text limits. No schema or quota widening.
- Fatal UTF-8; bounded depth/cardinality preflight before `JSON.parse`; duplicate object keys rejected. The accepted document is detached by `validateProject`. Bound both original bytes and canonical output. Preserve the existing portable validator's number/text policies, including legal negative zero; exact publication bytes are `JSON.stringify(validateProject(parsed))`, whose ordinary JSON representation spells negative zero as zero.
- Each embedded image retains its exact original data URL/PNG bytes and supplied dimensions. Reuse `validateAssetHeader`: dimensions 1–800 per axis, exact canonical base64, data URL at most 1.5 MiB, static PNG. Do not renormalize, remove valid ancillary metadata or narrow to 8-bit RGBA/noninterlaced output. Admission must support valid grayscale/palette/RGB/grayscale-alpha/RGBA, legal 1/2/4/8/16-bit depths, transparency and Adam7.
- Independently preflight complete PNG signature, chunk extents/count ≤4096, every CRC, first/unique IHDR, valid depth/type/filter/compression/interlace, legal critical ordering, palette/transparency requirements, contiguous IDAT, final IEND at exact EOF and no APNG. Unknown valid ancillary chunks may be retained/skipped; unknown critical chunks reject. Do not inflate compressed ancillary metadata.
- Compute exact expected inflated scanline length from width/height/depth/channels and all seven Adam7 pass dimensions. The maximum legal input is bounded below 6 MiB of inflated scanlines. Concatenate only bounded IDAT bytes, inflate with Node zlib `maxOutputLength = expected + 1`, require exact expected length and one complete consumed zlib stream with no trailing compressed payload, then full pngjs decode with CRC checking and exact 800-bound dimensions/width×height×4 output. No prefix-only decode acceptance or silent truncation.
- Images decode sequentially inside the one project worker. Explicit compressed/output bounds supplement worker V8 heap limits; V8 resource limits alone do not bound native/external Buffer memory. Discard decoded pixels; retain project bytes only. Decoder error/deadline/cancel publishes nothing.

## Frozen service limits

```ts
MAX_PUBLICATIONS = 8
MAX_PROJECT_BYTES = 6_291_624
MAX_INDEX_BYTES = 8192
MAX_PNG_CHUNKS = 4096
ADMISSION_TIMEOUT_MS = 30_000
ADMISSION_WORKERS = 1
MAX_CONNECTIONS = 16
LISTEN_BACKLOG = 16
TLS_HANDSHAKE_MS = 5000
HEADER_TIMEOUT_MS = 10_000
MAX_HEADER_BYTES = 16_384
MAX_HEADER_FIELDS = 64
SOCKET_IDLE_MS = 5000
BODY_TIMEOUT_MS = 15_000
RESPONSE_TIMEOUT_MS = 30_000
CONNECTION_TIMEOUT_MS = 75_000
SHUTDOWN_TIMEOUT_MS = 5000
```

Eight maximum project payloads total 50,332,992 bytes; index/runtime staging are additional. At most one publish admission/body buffer exists; a second publication while it is occupied receives a bounded busy refusal before body consumption. Reads can run concurrently within the socket pool. No waiting request/body/worker queue. PNG admission limits are capacities, not measured RAM or complex-photo speed claims.

## Configuration, bind and lifetime lock

CLI `node --experimental-strip-types server/main.ts --data-dir PATH --port N` defaults to HTTP loopback 127.0.0.1; default port 8770, port 0 allowed only in HTTP. Creation still requires an operator setup key file. Optional HTTPS requires all of `--bind --origin --tls-cert --tls-key`; HTTPS port is 1–65535. `--setup-token-file` is required in both modes. No anonymous/unbounded publishing on a static server.

Use app-local configuration semantics proven in Duet/Friendly: canonical decimal RFC1918 or 127/8 IPv4 bind only; no wildcard/global/link-local/IPv6, proxies or DNS interface resolution. HTTPS origin is canonical lowercase ASCII DNS/IPv4 authority with no path/query/userinfo; canonical port 443 omits `:443`, all other ports match listener exactly, numeric aliases reject. No origin mutation after startup. Default HTTP status uses the actual loopback authority; canonical port 80 is omitted, and all other actual ports are explicit in status, Host and Origin enforcement.

Before any library directory creation/read/mutation: validate Linux/procfs/flock availability, read bounded NOFOLLOW regular certificate/key/setup files, validate origin, construct TLS context from already admitted bytes, bind/listen successfully. Cert ≤128 KiB, key ≤32 KiB, setup exactly 64 lowercase hex with optional LF ≤65 B. Private key/setup owned by effective UID and exactly 0600. TLS ≥1.2; normal operator SAN/chain/browser trust required; no automatic CA/install/download or production trust bypass. Node TLS accepts copied Buffer key/cert, avoiding pathname rereads.

Library root is an owned real directory, 0700. Acquire/pin a directory FD and access fixed children through `/proc/self/fd/<fd>/...` with NOFOLLOW regular-file checks. Keep a fixed owned regular `.server.lock` 0600 FD open. Spawn system `flock -n 3` with that existing open file description inherited at FD 3; exit 0 proves acquisition. The parent retains the FD after the flock child exits. Do not unlink the lock, use PID files or mkdir locks. Independent two-process tests must prove refusal while the first parent retains it and admission only after actual release.

Shutdown stops admission/listener, closes owned sockets, cancels and awaits admission worker termination and outstanding filesystem operations, then releases store/root/lock FDs. A five-second deadline may refuse teardown while preserving the lock and permit another close attempt; it must never release the lock while an owned write can still publish. SIGTERM/SIGINT follow the same order. Same-UID hostile mutation is not sandboxed; compare pinned identities and refuse detected replacement, without claiming complete defense against every same-user race.

## Durable index, publication and revocation

Index JSON exact shape:

```ts
type Publication = {
  id: string; createdAt: string; projectSha256: string; projectBytes: number;
  readHash: string; revokeHash: string;
};
type PublicationIndex = { schemaVersion: 1; revision: number; publications: Publication[] };
```

IDs are lowercase UUIDv4; generated collision retry ≤32. `createdAt` is canonical ISO UTC, all digests lowercase SHA-256, revision is a safe nonnegative integer and must not overflow. Index ≤8192 bytes, ≤8 unique IDs, exact plain JSON fields. Project children are `<id>.motion.json`. Raw capabilities are 32 cryptographically random bytes encoded lowercase hex; read/revoke are independently generated, unequal and stored only as SHA-256 digests. Hash matching is constant-time. Never log digests/credentials/private links or place them in project/download files.

For publication: capture/admit canonical project, generate identity and authority, write a unique owned temp file NOFOLLOW/EXCL, fsync it, publish project via atomic hard-link no-replace, unlink temp and fsync directory. Write/fsync a new index temp and atomically replace index; fsync directory. The index replacement is the visibility commit. Return 201 and both capabilities only after durability confirmation. Before index commit cancellation/error leaves no visible publication; cleanup removes only owned unindexed output. After commit, cancellation/lost response may have created a publication; never claim rollback or retry automatically. If postcommit directory fsync fails, preserve complete committed state and report durability uncertain. The operator can remove an orphaned/unknown-link publication offline.

For revocation: authenticate revoke capability, atomically replace/fsync index without its entry first, then remove only that owned project file and fsync directory. Visibility disappears at index commit. Never restore authority on unlink/fsync failure. A response already authorized and holding an opened FD can finish; revocation forbids later requests, not retrieval of copies already received. Restart keeps revocation permanent.

Startup validates the bounded exact index and every referenced regular project file/hash/full project/image admission before serving its publication. No silent dropping/empty reset. Corrupt index/referenced data makes service startup refuse without overwriting bytes. Missing index synthesizes empty only if there are no publication files. Valid unindexed UUID project/temp children left before visibility commit are owned crash debris and can be removed after lock acquisition with inode checks; unknown/symlink children cause refusal, never arbitrary cleanup. Deletion debris for IDs no longer in a valid index is likewise unservable and removable. Fixed operator-only offline `--inspect` lists count/IDs/titles without authority; `--revoke-id UUID` holds the same lock and removes that publication through identical durable revocation, allowing recovery after a lost creation response. No HTTP listing endpoint.

## Raw TCP/TLS and HTTP authority

Accept raw TCP with `net.Server`; claim one of 16 slots before wrapping a `tls.TLSSocket`. Saturation closes the socket without handshake/worker. TLS handshake runs per admitted socket, with one five-second timer and a synchronous deadline check after handshake; never in the accept path. Pass a ready socket to an isolated Node HTTP server with strict parser/maxHeaderSize, no permissive HTTP parsing, no automatic redirect or HTTP/2. Keep-alive/pipelining unsupported: one request, Connection: close.

Owned timers use monotonic time and cover absolute header/body/response/total bounds; trickled bytes never reset absolute deadlines. Count the parsed raw header pairs without truncation, reject >64; parser allocation remains bounded by 16 KiB. Header counts exclude prefetched body bytes. Header watchdog begins when HTTP parsing begins, body before first consumed body byte, response before first write; stream/backpressure waits and final successful completions recheck deadlines. Track raw/TLS sockets and pending operation identities together. Do not block on TLS unwrap. Async exceptions/errors have fixed private-safe envelopes, no raw URL/key/path/stack logging.

Every request has exactly one Host equal to configured authority. Supplied Origin must equal configured origin; POST requires it. Reject duplicate security/framing headers, Forwarded/X-Forwarded-*, Transfer-Encoding, Expect, Upgrade, obs-fold, unsupported method, cross-site Sec-Fetch-Site, all query syntax/path traversal and GET/HEAD nonzero body. Content-Length is canonical bounded decimal; publication requires it and application/json. No cookies accepted as credentials or Set-Cookie, no CORS, redirects or query-token fallback.

Routes:

- GET `/api/status` → `{schemaVersion:1, transport:{mode:'http-loopback'|'https-lan',origin,setupRequired:true}, maxPublications:8, maxProjectBytes:6291624}`; no IDs/counts/secrets.
- POST `/api/snapshots`, creation-only `X-Motion-Setup-Key`, body canonical portable Project2 → `{id,createdAt,projectSha256,projectBytes,readToken,revokeToken}`. Wrong setup rejects before body/admission/capacity allocation. No setup credential grants viewing/revocation.
- GET/HEAD `/api/snapshots/<id>`, exactly one Bearer read capability → exact stored canonical JSON, Content-Length and SHA-256 response header. Do not accept revoke authority here. Absent/wrong/revoked authority gives the same fixed 404, without existence disclosure.
- POST `/api/snapshots/<id>/revoke`, exactly one Bearer revoke capability and empty body → success. Read capability cannot revoke; no role interchange.
- GET/HEAD packaged static assets and `/view`; fixed asset allowlist, bounded production asset bytes, no data-directory serving or fallback arbitrary paths.

No-store, no-referrer, nosniff and restrictive same-origin CSP everywhere; static scripts/workers permit only the app's required local assets and image/blob capabilities. Requests use credentials omit, redirects error and no retries. Viewer project responses ≤6,291,624 bytes are streamed/bounded, verified against authenticated descriptor/hash and decoded before display. An authorization failure never opens a cached previous snapshot under a newer link.

## Browser ownership and explicit local copy

Publisher uses stable UI outside rebuilt editor controls. `#private-links`, `#private-link-status`, `#private-link-setup` password/no name/autocomplete off, `#publish-snapshot` (Publish committed snapshot), `#cancel-publication`, returned `#private-view-link` and `#private-revoke-link`. Disclose exact committed title/bytes and that drafts/history are excluded. Require raw draft/tween resolution before publishing; capture immutable validated project and editor intent. Clear setup field at actual dispatch/pagehide, never persist it. Before dispatch capture nothing from a pending gesture. On success after newer edits, retain returned link as explicitly belonging to the captured snapshot without replacing current work; old completion cannot clear a newer request's busy/status state. Lost creation response says publication may exist, no blind retry; offline operator recovery is documented.

Viewing link `${origin}/view#snapshot=<id>&read=<token>` and management link `${origin}/view#snapshot=<id>&revoke=<token>` are separate. Scrub recognized private fragments before any fetch, keep credentials only in controller memory, never storage/history/export/telemetry. Malformed/duplicate/unknown fields fail closed. Page reload requires original link; no persistent credential cache. Read-only viewer has its own canvas/frame controls/assets/play/export worker and never borrows editor selection/time/drafts. Revoke link reveals no project through revoke authority and asks explicit confirmation; no automatic command on link opening.

Viewer selectors: `#snapshot-status`, `#snapshot-title`, `#snapshot-stage`, `#snapshot-frame`, `#snapshot-play`, `#snapshot-png`, `#snapshot-gif`, `#snapshot-cancel-export`, `#snapshot-project`, `#snapshot-open-local`, `#snapshot-revoke`. Use actual shared createFrameRenderer/exportGif and normal 640×360/12fps/PNG/GIF limits; no guides enter output. Cancel/pagehide/new link retires fetch/decode/export and releases every owned bitmap/object URL. Downloads use the one captured admitted snapshot, no credentials/library wrapper.

Open as new local project is explicit and uses the existing same-origin ProjectLibrary and prepare/create/publish transition: resolve current editor drafts/tween scratch, flush its save or confirm unsaved departure, enforce library room and actual image admission, then one atomic new-entry create. Preserve original saved projects and CAS conflict protection. A capacity failure or stale/cancelled fetch leaves exact current raw DOM, focus, assets/history and native rows intact. Do not download/click a synthetic File input to bypass existing transition guards. On a standalone `/view` page, use a dedicated fresh local-library admission controller with the same public storage APIs; never manufacture accepted receipts or activate an existing row silently.

## Proposed module/API seams and ownership

1. Domain/admission: new `server/project-admission.ts`, `server/project.worker.ts`, shared `server/types.ts`; pure metadata/index strict validation, exact PNG preflight and supervised Node decode. Export `admitPortableProject(bytes:Uint8Array,{signal}={}):Promise<{project:Project,json:Uint8Array,sha256:string}>`. No storage/network imports in worker; portable model unchanged.
2. Durable store/lock: new `server/snapshot-store.ts`; `SnapshotStore.open(path)`, `publish(admitted,{signal})`, `read(id,readToken)`, `revoke(id,revokeToken)`, operator inspect/revoke, `close()`. Opened authenticated file handle/read receipt remains owned by caller until completion. Sole writer of durable files/index, no worker decoder inside commit section.
3. Transport/CLI: new `server/transport.ts`, `server/http.ts`, `server/main.ts`; immutable prepared config, early listener bind, bounded socket/HTTP routing, shutdown/store lifetime. No browser/domain edits. Publish exact constructor/config/error types before store/UI consumers after root approval.
4. Browser: new `src/private-links.ts`, `src/snapshot-view.ts`, API helper and isolated `/view` entry; narrow `main.ts` hooks/index/style for committed capture and guarded new-entry admission. Sole UI owner; never change model/IndexedDB schema or weaken existing guards.
5. Independent protocol/storage oracle: literal PNG dialects/all depth types/Adam7/CRC/zlib corruption, true flock two processes, file/index crash phases, full hash/symlink/unknown debris, all authority and TLS/deadline/slot/refusal/restart tests.
6. Independent native/media: original drawing/PNG project, real publish/link/view, separate recipient context, decoded PNG/GIF frame/delay expectations, eight maximum publications, revoked/cancelled/lost replies and exact local-library admission/draft/recovery/CAS. Root owns dependencies/config/docs/Git/release and schedules build/runtime.

## Acceptance and remaining review decisions

Retain all 147 Motion units and 121 existing native cases plus lint/type/build. New genuine TLS tests use normal test CA/hostname validation and wrong chain/name failures. Native test-only exact SPKI trust may be used if trust installation is unavailable, distinctly documented; no production blanket ignore flags. Verify default static editor without service and service-origin offline editing separately. Actual full process restart must preserve all published canonical project bytes and original read/revoke authority; revoked links stay refused.

Original fixtures cover all valid PNG type/depth combinations, palette/tRNS, Adam7 and ancillary metadata; header-only/CRC-valid truncated/overinflated/concatenated streams fail before publication. Eight exact maximum payloads exercise actual JSON/image decode, durable bytes and native rendering; padded simple images are declared, not worst-case photographic/RSS proof. Packet trickle/handshake/body/response/slot deadlines and shutdown-held write prove no lock release before owned work ends.

Before implementation root reviews three concrete choices: Node raw TLS plus HTTP parser integration (real deadline/slot tests required); `flock -n 3` inherited-FD lifetime (real process proof required); app-local full PNG preflight plus pngjs (all existing valid PNG dialects retained). These are architectural review points, not placeholders for silently changing APIs later. Physical two-device trust/reachability remains unverified until actual hardware acceptance; this software slice does not claim public hosting.
