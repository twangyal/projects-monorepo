# Duet: a shared room for two people's music

Issue #18, idea #9, `apps/duet`, branch Astra. The user's autonomous instruction authorizes these decisions and implementation. The complete milestone is pair two profiles → supply real audio → independently rate → build an explainable mix → synchronize playback → attach dated memories → reopen/export. Own-file audio provides real listening without claiming Spotify integration or catalog access. A Python standard-library service is preferable to browser-only storage because the two participants must actually share durable state. Polling at one second is sufficient for a bounded room, simpler to recover than persistent socket infrastructure, and verified by measured media drift.

## Architecture and bounds

Use a TypeScript/Vite UI, native audio, a Python 3.11+ HTTP service, SQLite JSON room records, and FFmpeg/ffprobe for canonical Opus/Ogg media. No ML, accounts, or paid services. Bind strictly to 127.0.0.1; secure remote deployment and LAN discovery are later work. Two independent browser profiles/contexts demonstrate the actual shared protocol without making a broad network-latency claim. Service port: 8766; production Playwright port: 4220. Require Linux /proc and descriptor-relative filesystem operations; acquire an exclusive POSIX flock for the data directory before cleanup; use generated identifiers/files only. Static CSP is self-only, with no CORS. Validate Host and Origin against the exact loopback/localhost port.

At most 5 rooms, 2 participants per room, 12 tracks per room, and 100 memories per room. Uploads are limited to 25 MiB and 1–300 seconds of actual WAV/MP3/FLAC/static Ogg audio. Allow one active conversion job globally. Canonical stereo 48 kHz Opus/Ogg media is limited to 8 MiB; bound subprocesses to 45 seconds and 512 MiB RSS, with bounded logs. Reject external references, video, playlists, unsupported signatures, and malformed/oversized duration before publication. Original uploads are temporary; normalized audio persists. No automatic source downloads. Cancellation/termination removes partial files and reaps process groups. Room/model JSON requests are limited to 64 KiB; metadata export to 256 KiB. Names allow 1–40 characters, titles/artists 1–80 (artist may be empty), memory text 1–500, and valid YYYY-MM-DD dates from 1900–2100. IDs use 32 lowercase hex characters; bearer/invite tokens use 64 lowercase hex characters, are cryptographically random, and are hashed at rest. No secrets appear in room snapshots, exports, or logs.

## Domain contract (`duet/store.py`)

`DomainError(status:int,message:str)` exposes `.status`. `Store(data_dir:Path,now:Callable[[],float]=time.time)` uses clock seconds and provides `close()`. An internal RLock and SQLite BEGIN IMMEDIATE transactions protect every read/modify/write and join/revision race; the database file is `rooms.sqlite3`. Store never touches media files. Internal records include only hashed capabilities; safe snapshots omit hashes. The server holds the lifetime directory lock. Export pure `rank_tracks(tracks,ratings)->list[dict]` and `effective_playback(room,now)->dict` if useful, but the server should only need the methods below.

Exact snapshot shape:
`{id,title,createdAt,profiles:{host:{name},guest:{name}|null},myRole:'host'|'guest',serverTime,tracks:Track[],ratings:{[trackId]:{host:-1|0|1,guest:-1|0|1}},blend:Blend[],playlist:string[],playlistRevision:int,playback:Playback,memories:Memory[]}`.
All timestamps are milliseconds. `Track={id,title,artist,duration,uploadedBy:'host'|'guest',createdAt}`. `Blend={trackId,category:'mutual'|'discovery'|'unrated'|'mixed'|'avoid',reason:string}`. Order categories as mutual (+1,+1), discovery (+1,0), unrated (0,0), mixed (+1,-1), and avoid (other negative pairs); break ties stably by createdAt, then ID. Build mix excludes avoid and includes the others with explicit explanations; do not infer musical similarity. Missing guest ratings count as 0; the UI labels the waiting-partner/cold-start state.
`Playback={trackId:string|null,playing:boolean,position:number,revision:int}` records position AS OF snapshot.serverTime. Store privately retains the command anchor. Derive elapsed playback and automatically advance through the playlist when the current track belongs to it; stop at the final duration and never loop. Tracks outside the playlist stop at their end. The client extrapolates snapshots using serverTime plus measured clock offset. Revision increments only on explicit playback commands or deletion affecting playback. `Memory={id,trackId,trackTitle,date,text,author:'host'|'guest',createdAt}` retains title/ID after audio deletion; the UI marks audio unavailable.

Methods (all return snapshot except noted):
- `create_room(title,name)->{roomId,token,inviteToken,room:Snapshot}`; 409 when the quota is reached.
- `join_room(room_id,invite_token,name)->{roomId,token,room:Snapshot}`; one-use invite, 409 if occupied; a transaction prevents a double claim.
- `authenticate(room_id,token)->'host'|'guest'`; missing/invalid credentials return 401 or 404 consistently.
- `snapshot(room_id,token)->Snapshot`.
- `rotate_invite(room_id,token)->{inviteToken}` is host-only and requires an empty guest slot; invalidates the old invite.
- `rate(room_id,token,track_id,rating)->Snapshot` changes only caller's rating, validates track.
- `build_playlist(room_id,token,revision)->Snapshot`, `set_playlist(room_id,token,track_ids,revision)->Snapshot`; use a dedicated playlist revision, with 409 for stale requests; unique valid IDs, at most 12; empty allowed.
- `set_playback(room_id,token,track_id,playing,position,revision)->Snapshot`; dedicated revision, 409 for conflicts; strict boolean and finite position from 0 through track duration; null requires paused playback and position 0.
- `add_track(room_id,token,track_id,title,artist,duration)->Snapshot`; validates remaining quota and generated ID; the caller is the uploader.
- `delete_track(room_id,token,track_id)->Snapshot`; uploader or host only; removes ratings/playlist entry and increments playlist revision. If the current effective track is deleted, pause/reset playback and increment its revision. Retain memory snapshots.
- `add_memory(room_id,token,track_id,date,text)->Snapshot`; `delete_memory(room_id,token,memory_id)->Snapshot` is author-only.
- `export_room(room_id,token)->dict` provides versioned metadata with `schemaVersion:1` plus a snapshot without myRole/serverTime; never include a capability.
- `delete_room(room_id,token)->None` is host-only.
- `pause_all()->None` runs once at service startup to preserve effective positions and reset playing to false; close/restart should not unexpectedly autoplay.

## HTTP contract (`duet/server.py`, `duet/jobs.py`, CLI)

`create_server(data_dir:Path,port:int=8766,*,dist_dir:Path|None=None,normalize=None)->DuetServer` exposes `.server_port`, `.serve_forever()`, and `.server_close()`. Production defaults to the real normalizer; injections are test-only. CLI `python -m duet --data-dir PATH --port N` serves built dist and API from the same origin. Clean SIGTERM shutdown cancels/reaps active jobs and releases the lock. Startup cleans abandoned `.jobs` only after acquiring the lock. Media files use `data/media/ROOMID/TRACKID.ogg`; job work uses `.jobs/JOBID`. Allow one active upload job and 50 retained status records.

Every member request uses `Authorization: Bearer TOKEN`, except native audio GET/HEAD may authenticate with an HttpOnly SameSite=Strict cookie `duet_ROOMID`, Path `/api/rooms/ROOMID`, set by create/join/access. Writes REQUIRE the bearer header (cookies alone are insufficient) and exact origin when provided. Cookie and bearer token represent the same participant capability; the cookie supports native audio without putting secrets in media URLs. No token appears in query paths. Public room snapshots do not exist. The frontend removes the token fragment from the address bar after capture; session/local storage holds only its own credential. Unauthenticated GET status may report version/limits, but never a room list.

Routes:
- POST `/api/rooms`, JSON `{title,name}` → 201 create response plus member cookie.
- POST `/api/rooms/ID/join`, JSON `{inviteToken,name}` → 200 join response plus cookie.
- POST `/api/rooms/ID/access`, JSON `{}` plus bearer → Snapshot plus cookie (restore private access).
- GET `/api/rooms/ID` → Snapshot extended with `activeJob:Job|null`, visible only to this room.
- POST `/api/rooms/ID/invite`, JSON `{}` → `{inviteToken}`.
- PUT `/api/rooms/ID/ratings/TRACKID`, JSON `{rating}` → Snapshot.
- POST `/api/rooms/ID/blend`, JSON `{revision}` → Snapshot.
- PUT `/api/rooms/ID/playlist`, JSON `{trackIds,revision}` → Snapshot.
- PUT `/api/rooms/ID/playback`, JSON `{trackId,playing,position,revision}` → Snapshot.
- POST `/api/rooms/ID/tracks`, raw octets, `X-Track-Title:encodeURIComponent(title)`, `X-Track-Artist:encodeURIComponent(artist)`, bearer → 202 `{job}`. Prevalidate authentication/room quota and reserve the job before reading the body; apply socket/time/size caps.
- GET/HEAD `/api/rooms/ID/tracks/TRACKID/audio` → audio/ogg using the exact generated path; validated bounded single-byte ranges/206/416/HEAD, with cookie or bearer.
- DELETE `/api/rooms/ID/tracks/TRACKID`, JSON `{}` → Snapshot; no dangerous path interpolation. Remove metadata atomically, then only the selected fixed file. Reject room deletion with 409 when this room has an active upload; other track deletion is allowed if it is not the current new job's track.
- GET `/api/rooms/ID/jobs/JOBID` → `{job}`; POST `.../cancel`, JSON {} → `{job}`. Only the uploading participant or host may cancel; unrelated room returns 404.
- POST `/api/rooms/ID/memories`, JSON `{trackId,date,text}` → Snapshot; DELETE `.../memories/MEMORYID`, JSON {} → Snapshot.
- GET `/api/rooms/ID/export` → token-free metadata JSON attachment.
- DELETE `/api/rooms/ID`, JSON {} → `{deleted:true}`, host-only; cleanup affects only the selected room.

`Job={id,roomId,trackId,uploadedBy,status:'running'|'complete'|'failed'|'cancelled',stage,error?}`. Publication normalizes into the job directory, atomically renames output to the fixed media path, and calls add_track; on metadata failure, remove only the new unpublished file. No partial track is published on failure. Deletion cleanup failures may leave orphan files but must not delete other records. Server startup model/state validation errors remain visible. Stream direct GET media outside shared state locks.

## Audio pipeline (`duet/media.py`)

`normalize_audio(source:Path,output:Path,cancel:threading.Event,stage:Callable[[str],None])->float` writes validated canonical Opus/Ogg and returns actual duration; the parent has no AI imports. Use fixed shell-free subprocess arguments, signature and format/protocol allowlists, channel/duration validation, and cancellation/output/log/time/RSS limits. Kill and reap process groups. Run ffprobe before and after output; account for codec pre-skip/padding without silently trimming long input. Test real FFmpeg short and five-minute boundaries, invalid inputs, cancellation, and preservation during publication. The function preserves the original source file; the server owns temporary cleanup.

## Client synchronization (`src/sync.ts`)

Types `Playback` and `Track` follow the snapshot above, plus `SyncSnapshot={serverTime:number;playback:Playback;tracks:Track[]}`.
Pure `estimatedPosition(snapshot:SyncSnapshot,nowServerMs:number):number` extrapolates and clamps; `clockOffset(serverTime:number,requestStart:number,responseEnd:number):number` uses the request midpoint. Validate finite values. `AudioSync` exposes `constructor(audio:HTMLAudioElement,onStatus:(message:string)=>void)`, `enable():Promise<void>` through an explicit user gesture, `apply(snapshot:SyncSnapshot,audioUrl:(trackId:string)=>string,offsetMs:number):void`, `disable():void`, `destroy():void`, and the `enabled:boolean` getter. Compute target position using Date.now()+offsetMs. Resync immediately after metadata, on track change, and when absolute drift exceeds 0.35 seconds; avoid unnecessary seeking within the threshold. Apply server pause without mutating the room. Explicit enable gates remote playback; rejected play reports an actionable message, with no unhandled promise. Root polls every second and passes snapshots; native audio has its own volume input. Callback statuses distinguish muted/waiting, blocked, and ready. Keep the latest snapshot across asynchronous metadata loading; do not play a stale old track. The current API intentionally makes no server writes from audio events, preventing feedback loops.

## UI and lifecycle

Use a warm editorial room UI: title/two participant names, invite/private access link controls, real upload form/library with independent ratings, explainable blend and ordered playlist, sticky shared transport, and dated memory timeline. Root stores a room/token map in localStorage with try/catch. The current URL uses `?room=ID#invite=TOKEN` for guests or `#access=TOKEN` for own-seat recovery; immediately remove fragments. Do not automatically overwrite the current participant with foreign access without user intent (show a join/switch card when a room credential already exists). Provide a copyable private access link only through an explicit button and explain that it grants the participant's role; do not include it in exports. Token-storage failure still permits in-memory use and copying the access link. Validate room ID from the URL before fetching. Create/join forms require user names; the guest invitation view only requests after explicit join. Poll with generation cancellation and an out-of-order response guard. Focused inputs and memory drafts survive background refresh; use DOM text rendering only. Fetch metadata exports with authentication, then create a Blob; cookie-authenticated media URLs contain no auth secrets. Restart recovery through auth/access sets the cookie, then polls. Optimistic revisions report conflicts without silently losing drafts.

## Ownership and verification

- audio_engine: media.py and test_media.py.
- git_runner: server.py/jobs.py/__init__.py/__main__.py and test_server.py.
- git_history_review: store.py and test_store.py (fresh app owner, later reviewed by another agent).
- recorder: sync.ts and synchronization tests/harness.
- root: package/config/main.ts/styles/browser workflow/docs/catalog/CI/integration.
- git_reader independently completes existing issue 17 in apps/git-history; no Duet files.

Real two-context browser acceptance: create/join → upload genuine audio → ratings → explainable mix → enable audio in both → play/seek/pause/next with drift below 0.5 seconds → memory → reload and server restart → metadata export. Test authentication isolation, expired/consumed invitations, concurrent joins/revisions, unsupported media/limits, worker failure/cancellation, blocked autoplay, reconnects, and stale snapshots. Do not fabricate synchronization evidence. CI uses real normalization and native browser audio, not fake audio callbacks. README describes the local-only verified scope, codec/limits, and backup/access requirements.
