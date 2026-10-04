# Duet

A private local music room for two people: bring your own audio files, rate songs independently, build an explainable shared mix, listen together, and attach dated memories. No accounts, paid services, or streaming subscription are required. Spotify integration, catalog access, and musical-similarity recommendations are not implemented.

## Run locally

Requirements: **Linux**, **Python 3.11+**, **Node.js 22.18+** (CI uses Node 24), and **FFmpeg/ffprobe** on your PATH. FFmpeg must include the **libopus** encoder. The service requires `/proc`, directory-relative filesystem operations, POSIX locking, and process/resource controls. Startup checks these requirements; macOS and Windows are not currently supported.

From the repository root:

```sh
cd apps/duet
npm ci
npm run build
python3 -m duet --data-dir "$HOME/.local/share/duet" --port 8766
```

Open [http://127.0.0.1:8766](http://127.0.0.1:8766). Python runtime dependencies are all standard library; no pip install is needed to run the service. On Ubuntu, install the media tools with `sudo apt-get install ffmpeg`.

The Python service serves the built `dist/` site and API from the same origin. For development, keep that service running and run `npm run dev` in a second terminal. It rebuilds the static site on changes; refresh the browser after a rebuild. It does not run a separate browser-facing Vite server.

## Pair two seats

1. Enter your name and a room name, then choose **Create our room**. This creates the host seat and a one-use invitation for the guest seat.
2. Open the invitation in a **separate browser profile or private browser context**, enter the second person's name, and choose **Join the room**. Independent profiles keep the two participants' cookies and saved credentials separate.
3. Each participant should save **My private access link** for their own recovery. **Back to rooms** returns to that browser's saved room list without deleting the room.

An **invitation** claims the second seat once. Before it is claimed, the host can use **Invite your partner** to replace it; earlier unclaimed invitations then stop working. Once a guest joins, the invitation cannot be reused and a third seat cannot be added.

A **private access link** restores an existing host or guest seat. Anyone holding it can act as that participant, so keep your own link private and give your partner the invitation instead. Access links use a URL fragment that the app removes after reading it. The browser saves its own credential locally when storage is available; if storage is blocked, the current session can still work, but keep the private link before closing it. Native audio uses a room-scoped cookie rather than a token in its media URL.

By default these links refer to the service on **your computer**. To use two devices on a trusted local network, configure the HTTPS mode below. There is no network discovery, public internet hosting, reverse-proxy mode or automatic certificate installation.

## Use HTTPS on a trusted local network

The operator supplies a certificate and unencrypted private key for one stable service address. Both browsers must normally trust its issuer, and the certificate's subject alternative name must match the address in the link. Arrange this with your existing local certificate authority and device trust settings; Duet does not create or install an authority. Do not bypass browser certificate warnings. Automated HTTPS tests use separate original fixtures; physical two-device certificate setup and listening remain unverified.

Choose the computer's actual private IPv4 address, a port and an exact HTTPS origin. For example, if the computer owns `192.168.1.42` and the certificate includes that IP address, use `https://192.168.1.42:8766`. A lower-case DNS name also works if both devices resolve it to that computer and the certificate covers the name. The bind address must be a specific RFC1918 private or loopback IPv4 address. Wildcards, public addresses and IPv6 are not accepted. Keep the service on a trusted LAN; configure any firewall access yourself for those devices without internet port forwarding.

Create a fresh operator setup key file in a private directory. This command refuses to overwrite an existing file and never prints its contents:

```sh
python3 - <<'PY'
import os
from pathlib import Path
import secrets
path = Path.home() / '.config/duet/setup-key'
path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w', encoding='ascii') as output:
    output.write(secrets.token_hex(32) + '\n')
PY
```

Keep both the TLS private key and setup key owned by the service user, with exact mode `0600`. They must be ordinary files, not symbolic links; an encrypted private key is refused without a password prompt. The certificate may be at most 128 KiB, the private key 32 KiB, and the setup file exactly 64 lower-case hexadecimal characters with an optional final newline. All five transport flags are required together:

```sh
python3 -m duet --data-dir "$HOME/.local/share/duet" --port 8766 \
  --bind 192.168.1.42 --origin https://192.168.1.42:8766 \
  --tls-cert /absolute/path/to/certificate-chain.pem \
  --tls-key /absolute/path/to/private-key.pem \
  --setup-token-file "$HOME/.config/duet/setup-key"
```

Use your actual address and file paths. The origin has no trailing slash, path or query; its explicit port must equal `--port` (port 443 instead omits `:443`). Invalid configuration and a failed HTTPS bind are rejected before saved rooms are opened or paused. The server prints its public origin, without credentials. Transport configuration is read at startup; stop and restart the service to change it.

Open that origin in the operator's browser. Enter the setup file's contents in **Operator setup key** when creating a room; retrieve it privately with your local editor. This key authorizes creation only. It cannot enter an existing seat, play private audio or replace an invitation. The browser clears the password field when dispatching the request and does not save the key. Share the guest invitation with the other device, and retain each participant's own private access link separately. Each device must still choose **Enable audio on this device**.

Creation is never automatically replayed. If its response is lost, the room may already exist, so check a saved private access link before trying again. A response lost before its private credential reaches the browser cannot be recovered from the setup key or database hashes; a new attempt may consume another room slot. Changing the service origin requires opening each original private access link with only its origin changed. Old browser storage belongs to its old origin; changing the address does not mint new seats or synchronize separate library copies.

HTTPS requires TLS 1.2 or newer, the exact configured Host, and the exact Origin on every mutation. Forwarded/proxy headers and cross-site requests are rejected. Media cookies gain `Secure` while retaining room scope, `HttpOnly` and `SameSite=Strict`; room credentials stay out of audio URLs. The listener admits at most 16 connections with a backlog of 16. Each connection serves one request: a 5-second TLS handshake, 10-second/16-KiB/64-field header limit, 5-second socket idle timeout, 30-second body and response phases, and 75-second total lifetime. Shutdown closes owned connections and joins requests before releasing the library lock. If a handler cannot stop within its 5-second join budget, cleanup refuses to release the live library's ownership.

## Bring songs, build a mix, and listen

- Choose a **WAV, MP3, FLAC, or audio-only Ogg** file, supply its title and optional artist, then press **Add to our library**. Files must contain 1–300 seconds of audio and be at most 25 MiB. Whole inputs are validated and converted locally; long songs are rejected rather than silently trimmed. **Cancel upload** discards pending conversion without publishing a partial track.
- Each participant chooses **Like**, **Neutral**, or **Pass** independently. Neutral and an unset vote both use the zero/unrated bucket in this initial model.
- **Build our mix** ranks mutual likes first, then one-person likes with the other neutral/unrated, tracks with both neutral/unrated, and like/pass disagreements. Tracks with a pass and no like are excluded. The explanation under **How the blend is ranked** comes from these submitted votes; ties use stable upload order/ID. Move songs up/down to choose your own playlist order. Rebuild after rating changes to regenerate the mix.
- Each person presses **Enable audio on this device**. **Listen**, **Play together/Pause together**, **Previous**, **Next**, and the seek slider change shared playback. Audio permission and volume remain local to each browser. Browsers may require another explicit click if autoplay is blocked.
- Playlist playback advances to the next song and stops after the final song; it does not loop. A song outside the playlist stops at its end. Server restart preserves room data and pauses playback rather than starting it automatically.
- Choose a song, date, and memory text, then press **Keep this memory**. Each person can delete their own memories. Removing a song preserves memories with its recorded title and marks the audio unavailable.

The uploader or host can **Remove** a track after confirmation. Only the host can **Delete this room**, also after explicit confirmation. Deletion frees the relevant quota and affects the selected track/room only. These removals are not undoable.

## Limits and processing

- **5 rooms**, **2 participants per room**, **12 tracks per room**, and **100 memories per room**.
- Uploaded audio: **25 MiB**, **1–300 seconds**, 8–192 kHz sampling, and 1–8 channels. Inputs must have one audio stream; remote references, playlists, video streams, and unsupported containers are rejected.
- Stored media: stereo **48 kHz Opus in Ogg**, at most **8 MiB per track**. Original uploads are temporary; normalized audio is retained. Opus is lossy, so this is not an archive of the original recording.
- One active conversion job across the service, up to 50 retained job statuses; conversion is bounded to 45 seconds and 512 MiB of worker memory, with output/log limits. Slow machines may time out. Failed/cancelled conversions preserve completed tracks.
- JSON request bodies: **64 KiB**; exported metadata: **256 KiB**.
- Participant names: 1–40 characters; room/song titles: 1–80; artist: 0–80; memory text: 1–500; valid memory dates: 1900–2100.

Room data lives in SQLite, with normalized media stored separately inside the supplied data directory. An exclusive lifetime lock prevents two service instances from using that directory at once. Closing the service cancels active jobs and releases the lock.

## Backups and private access

**Export room notes** downloads readable JSON containing the room's tracks, votes, mix, playback metadata, and memories. It contains **no access credentials or audio** and cannot restore an editable room.

For a complete library archive, first **stop the service gracefully** and retain **each participant's private access link** separately. Run these commands from `apps/duet`:

```sh
python3 -m duet.backup create \
  --data-dir "$HOME/.local/share/duet" --output "$HOME/duet-library.zip"
python3 -m duet.backup inspect --archive "$HOME/duet-library.zip"
python3 -m duet.backup restore \
  --archive "$HOME/duet-library.zip" --data-dir "$HOME/.local/share/duet-restored"
python3 -m duet --data-dir "$HOME/.local/share/duet-restored" --port 8766
```

The output file and restore directory must **not already exist**; their parent directories must exist. The archive must be outside the source library. There is no overwrite or merge option. A running service, an unfinished database journal, invalid records, missing audio, or unexpected media files cause rejection without repairing or changing the source. Preserve database sidecars if recovery is needed; do not delete them to bypass a rejection.

Create, inspect, and restore validate the complete library, including every audio file's checksum, Ogg structure, and full stereo 48 kHz Opus decode. The portable archive contains the original room IDs, private credential/invitation **hashes**, profiles, individual ratings, playlist order, dated memories (including removed songs), and exact stored Opus bytes. It excludes temporary uploads and runtime jobs. Stored Opus is lossy; the archive does not recover original uploads.

Use the original private link to return to the corresponding host or guest seat; change only its origin if the service address/port changed. A used invitation stays used, and an unused invitation still requires its original link. The archive never recovers lost raw credentials or creates replacement seats. Browser storage alone is not a backup. Restored records form an independent library; edits do not synchronize back to the source, and archived ratings/memories are not new participant approvals.

Playback resumes **paused at the last saved anchor**, which can precede the last audible position. Offline time is never replayed. An originally playing anchor advances its playback revision once, so an old playing command cannot resume it; originally paused revisions stay unchanged.

Archives are **unencrypted private data**. Keep the file and separately saved access links private. Limits are five rooms, sixty tracks, 8 MiB per track, 256 KiB per room record, and 512 MiB per archive. Each command has a five-minute total deadline; each decoder retains its 45-second/512-MiB limits. Slow machines can reject a valid large library safely. Cancellation before publication removes only owned temporary output. If the final durability sync fails after publication, the command reports that the complete output exists; preserve and inspect it before retrying.

## Synchronization scope

The app polls shared state approximately once a second, estimates server clock offset, and corrects substantial playback drift. It uses actual native media playback and authenticated range-capable audio responses. Pauses and seeks apply to both seats; conflicting stale commands report an error instead of silently overwriting newer state.

Each new enabled playback start aligns to the shared clock before native playback begins and reconciles the latest snapshot when startup completes. This also covers delayed decoder startup and seeks arriving while playback is starting. Ongoing drift correction retains its 350 ms threshold. A late start cannot override a newer pause, disabled audio, selected song or reached endpoint.

Playback revisions also advance when a song automatically changes, the final
song stops, or the service pauses playing audio on restart. A delayed command
from an earlier song or before that restart is rejected; refresh the latest
state and retry. Ordinary elapsed playback and repeated polling keep the same
revision. Observed song transitions are saved so other connections see the same
transport generation.

Automated verification targets Chromium with independent contexts and real normalized audio. Same-machine drift checks establish the local shared protocol; they do not establish synchronization on arbitrary networks, physical output-device latency, or support in every browser. Ogg/Opus playback and autoplay behavior require separate evaluation elsewhere.

## Verify

Fast checks need FFmpeg/ffprobe, the OpenSSL command-line tool for original test certificates, and development-only Ruff; there is no ML runtime or model download:

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m unittest discover -s tests -v
python3 -m compileall -q duet tests
ruff check .
npm run check
npm run typecheck
npx playwright install chromium
npm run test:browser
```

`npm run check` runs TypeScript unit tests, ESLint, and the production build, which also checks types. Individual commands are `npm run test`, `npm run lint`, and `npm run build`. For an existing Chromium executable:

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

Playwright builds the production site with `DUET_TEST_HARNESS=1` and runs a fresh local service on port 4220. If that port is in use, choose a free port with `DUET_TEST_PORT=4304 CHROMIUM_PATH=/path/to/chromium npm run test:browser`; the runner refuses to reuse a running service. The flag adds isolated synchronization test pages; normal builds omit them. The browser server uses the real FFmpeg normalizer, and synchronization tests use native audio. Python media tests inspect actual codec, duration, and conversion boundaries; domain/HTTP tests exercise participant isolation, invitations, revisions, quotas, persistence, and cancellation. CI installs standard-library Python tooling, Ruff, FFmpeg, OpenSSL, npm dependencies, and Chromium; no external music service is needed.

HTTPS browser cases additionally start fresh HTTPS services on available ports with original temporary certificates and setup files. Only the exact fixture public-key fingerprint is excepted in their isolated Chromium process; production has no certificate bypass. Separate native Python SSL tests verify trusted chains and reject the wrong name, unknown authority and expired certificates. Secrets are kept out of committed evidence; test services and temporary private files are cleaned up.

[The measured five-minute media gate](docs/media-verification.json) records an original synthetic stereo FLAC converted to 300.000 seconds of decoded Opus audio in 5.77 seconds, with 39 MiB maximum child RSS on the test machine. It includes reproduction commands and measurement limits; this is not a quality assessment or a guarantee of runtime on other machines.

The startup-alignment repair ([#55](https://github.com/twangyal/projects-monorepo/issues/55)) passed **66 Python, 6 TypeScript and 23 native production browser cases**, including seven new delayed-start/ownership regressions, plus Ruff, ESLint, type checking and the normal build. The original drift assertion remains unchanged. Both local Chromium 151 and [Chromium 153 CI](https://github.com/twangyal/projects-monorepo/actions/runs/37178669377) passed; all twelve project workflows passed implementation commit `4ebb8f1`. The scheduling regressions hold the first native play invocation, then release actual decoded playback; they do not synthesize a playing clock. See [startup verification evidence](docs/2026-10-04-startup-verification.json) for the reproduced defect, test scope and limits.

The complete archive workflow ([#65](https://github.com/twangyal/projects-monorepo/issues/65)) passes **145 Python, 6 TypeScript and 25 native browser cases**, plus Ruff, ESLint, type checking and build. Independent fixtures verify original private seats, pending/used invitations, deleted-song memories, exact audio, paused checkpoint revisions, source immutability, cancellation and raced destinations. Native tests recover both original seats, play restored audio and preserve subsequent edits across restart.

An optional full-capacity gate creates five rooms, sixty three-minute tracks and 500 memories, then runs the real create/inspect/restore commands and starts the normal service twice. It requires a **new directory**, at least **2 GiB free**, and several minutes:

```sh
python3 scripts/smoke_archive_maximum.py --directory /path/to/new-duet-archive-evidence
```

The gate retains its original sources, complete archive, restored library and measurement JSON. Each 8 MiB fixture uses legal OpusTags padding; independently decoded PCM must equal the original normalized 300-second track. These are real playable byte-limit fixtures, not ordinary normalizer output. RSS measurements cover the CLI process, not decoder descendants; individual decoder bounds remain enforced by the production service.

The measured full-capacity gate produced a **503,706,257-byte archive**. Create, inspect and restore passed in **122.51 s, 117.87 s and 125.47 s**, preserving all original source files and restoring all sixty audio files byte for byte. Both ordinary service restarts retained the paused 17.25-second checkpoints with a single revision increment. The [verification record](docs/2026-10-04-library-archive-verification.json) records hashes, original defect reproductions, CI status, native recovery and the scope of the resource measurements.

All twelve project workflows passed the complete archive implementation `726a996c008e8da1b2e7143773f3c81b2cb67e96`; [Duet CI](https://github.com/twangyal/projects-monorepo/actions/runs/37194799973) passed the same 145 Python, 6 TypeScript and 25 browser cases with Chromium 153.

## HTTPS acceptance (#107)

Version 0.3 preserves the loopback workflow and adds explicitly configured HTTPS. Local verification passes a full **182-case Python run**, then the additional immediate-restart regression in an **11-case producer gate**: 183 distinct Python cases now exist. All six TypeScript tests, lint, type checking and normal build pass. Production Chromium verification covers **30 distinct cases** across the existing 25-case suite and five HTTPS cases. These are documented passing scopes, not a claim of one final local combined run; final published-head CI is recorded below. See the [verification receipt](docs/2026-10-04-https-lan-verification.json), [producer tests](docs/2026-10-04-https-lan-producer.json) and [CLI/client receipt](docs/2026-10-04-https-lan-client.json).

Independent tests found and fixed a numeric-host alias, shutdown lock ordering, unsafe CLI bind-error output and missing socket reuse on immediate HTTPS restart. The [protocol receipt](docs/2026-10-04-https-lan-protocol.json) records original certificate-chain/name/expiry checks, real 16-connection saturation, actual 5-second handshake and 10-second trickled-header deadlines, exact 16 KiB/64-field limits, private authority, and native audio ranges. Body/response/total/shutdown deadline branches use explicitly scaled constants. A separate exact 8 MiB response checks transport capacity and backpressure with opaque original bytes; it is not a playable-media or memory-use claim.

The [native receipt](docs/2026-10-04-https-lan-native.json) retains the first restart failure and unchanged repaired case. Two independent seats use original 12-second audio, separate ratings, reordered mix, explicit audio consent, pause/seek and memories. Same-port service restart preserves original private seats and exact normalized Opus; fresh contexts recover each original role. The retained 194,009-byte Opus decodes independently to 12 seconds with the original 277 Hz tone. Setup keys are not retained, lost creation responses are not replayed, and delayed real responses cannot overwrite newer drafts or reactivate a departed room. Desktop and 390px layouts have no horizontal overflow.

A separate [private-interface check](docs/2026-10-04-https-lan-private-interface.json) binds the actual RFC1918 interface, uses normal strict CA/IP-SAN validation, and retains both original seats across immediate restart. It remains same-host traffic. Physical device certificate installation, arbitrary network timing and output-device synchronization are unverified. No system certificate trust or network configuration was changed.

At the first published HTTPS head `6bc47b265338cd95acd90239bcb5d77083f8aa4b`, PR CI passes **183 Python, six TypeScript and all 30 browser cases**; all thirteen project PR workflows pass. Push passes the same Python/TypeScript checks but exposes a browser-test ordering error (29/30): the guest's native clock had naturally passed 2.8 seconds before receiving the host's seek revision, so its pause correctly received a stale-revision 409. The [first CI receipt](docs/2026-10-04-https-lan-ci-first.json) retains the actual request timeline. The test now waits for the partner's completed snapshot carrying the seek revision and asserts the pause uses it. The affected case passes against the unchanged normal bundle, with all original media/restart assertions and tolerances preserved. Final [push CI](https://github.com/twangyal/projects-monorepo/actions/runs/37233367305) and [PR CI](https://github.com/twangyal/projects-monorepo/actions/runs/37233369756) at `880070a6ee83707434e293a986a9d6aedaa6522d` each pass **183 Python, six TypeScript and all 30 native browser cases**, plus static/build checks. The actual PR merge has the identical source tree, and all thirteen project PR workflows pass. The [final CI receipt](docs/2026-10-04-https-lan-ci.json) preserves actual checkouts, timings and log hashes. Physical two-device acceptance remains open in [#109](https://github.com/twangyal/projects-monorepo/issues/109).
