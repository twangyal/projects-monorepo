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

These links refer to the service on **your computer**. The current service binds only to loopback; it does not provide LAN discovery, remote invitations, secure internet hosting, or multi-device deployment. The verified listening scope is two independent browser contexts on one machine. Secure remote deployment is separate future work.

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

Fast checks need FFmpeg/ffprobe and development-only Ruff; there is no ML runtime or model download:

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

Playwright builds the production site with `DUET_TEST_HARNESS=1` and runs a fresh local service on port 4220. The flag adds isolated synchronization test pages; normal builds omit them. The browser server uses the real FFmpeg normalizer, and synchronization tests use native audio. Python media tests inspect actual codec, duration, and conversion boundaries; domain/HTTP tests exercise participant isolation, invitations, revisions, quotas, persistence, and cancellation. CI installs standard-library Python tooling, Ruff, FFmpeg, npm dependencies, and Chromium; no external music service is needed.

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
