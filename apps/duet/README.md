# Duet

A private, self-hosted music room for two people. Each person can connect Spotify so the room builds an automatic shared listening timeline with song-linked memories, and the pair can also upload their own audio, rate songs, build a shared mix and listen in sync. A Python standard-library service serves the API and a TypeScript single-page app from one origin.

**Status:** DEFERRED (2026-10-25) — paused while the portfolio focuses on Gaze Navigator, Clothing Studio and Karaoke Studio. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **Two-seat rooms:** create a room, share a one-use invitation for the second seat, and recover a seat with a private access link. Up to 5 rooms per service.
- **Spotify listening timeline:** each person connects their own account (PKCE, no client secret). Duet checks connected accounts about every 10 minutes (or on demand) and adds entries automatically: songs you both played, first-time listens, and new Liked Songs.
- **Timeline curation:** hide/show entries, add captions, and write your own dated entries.
- **Memories:** attach dated text and an optional photo (JPEG, PNG, WebP or GIF, up to 5 MiB) to any timeline song or written entry; only the author can edit or delete.
- **Songs to share:** suggestions drawn from songs your partner liked or replayed that you have not been seen playing.
- **Playlists from the timeline:** preview and create a private playlist (up to 100 songs) in your own Spotify account from a filtered slice of the timeline.
- **Uploaded-audio library:** add WAV, MP3, FLAC or Ogg files (1–300 s, up to 25 MiB), normalized locally to Opus; rate Like/Neutral/Pass; build an explained ranked mix; keep up to 8 named mixes.
- **Synchronized listening:** shared play/pause/seek/next across both seats with clock-offset estimation and drift correction.
- **Exports and backups:** room-notes JSON export (no credentials or audio), and offline full-library archive create/inspect/restore.
- **Optional HTTPS on a trusted LAN** for using two devices.

## Known gaps

- Real two-account Spotify use has not been evaluated end to end; Spotify's recently-played endpoint returns at most 50 plays per check, so heavy listening can be undercounted.
- No Spotify playback, catalog search or musical-similarity recommendations; the in-room player only plays uploaded audio.
- Library archives do not include the Spotify timeline, its memories, photos or connections.
- Self-hosted on one Linux machine only; no public hosting, accounts or mobile app. Physical two-device HTTPS setup and sync over real networks are unverified.
- Only Chromium is tested.

## Run locally

Requirements: Linux, Python 3.11+, Node.js 22.18+ (CI uses Node 24 and Python 3.11), and FFmpeg/ffprobe with the libopus encoder on `PATH` (Ubuntu: `sudo apt-get install ffmpeg`). The service has no third-party Python runtime dependencies. macOS and Windows are not supported.

```sh
cd apps/duet
npm ci
npm run build
python3 -m duet --data-dir "$HOME/.local/share/duet" --port 8766
```

Open http://127.0.0.1:8766 (the default binding is loopback only). For frontend work, keep the service running and run `npm run dev` in a second terminal; it rebuilds `dist/` on change, then refresh the browser.

**Spotify (optional).** Create an app in the Spotify developer dashboard, add the redirect URI `http://127.0.0.1:<port>/spotify/callback` (or `<origin>/spotify/callback` in HTTPS mode; Spotify accepts the loopback IP, not `localhost`), and start Duet with its client ID via `--spotify-client-id` or the `DUET_SPOTIFY_CLIENT_ID` environment variable. No client secret is used. Requested scopes are `user-read-recently-played`, `user-library-read` and `playlist-modify-private`. Spotify's development-mode apps currently require the app owner to have Premium and allow a small number of users. Without a client ID the timeline still accepts written entries.

**HTTPS on a trusted LAN (optional).** Pass all five of `--bind <private or loopback IPv4>`, `--origin https://<address>:<port>`, `--tls-cert`, `--tls-key` and `--setup-token-file` together. The certificate must cover the origin and be trusted by both browsers; Duet never installs or bypasses trust. The TLS key and setup-key file must be regular files owned by the service user with mode 0600; the setup key is 64 lowercase hex characters (e.g. from `secrets.token_hex(32)`) and only authorizes creating rooms. Wildcard, public and IPv6 binds are refused, and proxies are unsupported. Never commit keys or tokens.

**Credentials to keep private:** a private access link lets anyone act as that seat; share only the invitation with your partner.

## Verify

```sh
python3 -m pip install -r requirements-dev.txt   # Ruff
python3 -m unittest discover -s tests -v          # needs ffmpeg and openssl
python3 -m compileall -q duet tests
ruff check .
npm run lint
npm run typecheck
npm test                                          # TypeScript unit tests
npm run check                                     # test + lint + build
npx playwright install chromium
npm run test:browser                              # builds and runs a test service on port 4220
```

Set `DUET_TEST_PORT` or `CHROMIUM_PATH` to override the browser-test port or browser. CI: `.github/workflows/duet.yml`.

Full-library archive commands (run with the service stopped; output and restore paths must not exist):

```sh
python3 -m duet.backup create --data-dir "$HOME/.local/share/duet" --output "$HOME/duet-library.zip"
python3 -m duet.backup inspect --archive "$HOME/duet-library.zip"
python3 -m duet.backup restore --archive "$HOME/duet-library.zip" --data-dir "$HOME/.local/share/duet-restored"
```

`scripts/smoke_archive_maximum.py` and `scripts/smoke_saved_mixes.py` are optional full-capacity probes (several minutes, about 2 GiB of disk); they are not part of CI.

## Project layout

- `duet/__main__.py` — CLI entry point and options.
- `duet/server.py`, `duet/store.py` — HTTP API, static serving and SQLite room store.
- `duet/transport.py`, `duet/https_server.py` — loopback and HTTPS/LAN transport.
- `duet/spotify.py`, `duet/listening.py`, `duet/photos.py` — Spotify client, timeline ingestion and memory photos.
- `duet/media.py`, `duet/jobs.py` — bounded FFmpeg normalization jobs.
- `duet/backup.py`, `duet/archive_*.py` — library archive create/inspect/restore.
- `src/main.ts`, `src/timeline.ts`, `src/saved-mixes.ts`, `src/sync.ts` — browser app, timeline UI, mixes and playback sync.
- `tests/` — Python unit/HTTP/media tests, TypeScript `*.test.ts` and Playwright `*.spec.ts`.

## Data & privacy

Everything is stored in the `--data-dir` on the host machine: rooms in SQLite, normalized Opus audio, and memory photos under `photos/`. Original uploads are temporary and Opus is lossy. Spotify tokens and imported listening live in `listening.sqlite3` (mode 0600), never reach the browser, and are excluded from room-notes exports and archives. **Disconnect my Spotify** deletes that person's credential and imported listening; deleting the room deletes everything. The only outside service contacted is Spotify, and only when a client ID is configured. Library archives are unencrypted and contain private data and credential hashes; store them privately.
