# Friendly Challenges

A private, self-hosted notebook for friendly bets between two people, with stakes limited to bragging rights or ordinary favors (never money). Participants agree on terms, a deadline and an evidence rule, post evidence, and settle the result together, with an optional mutually approved arbiter for disputes. Small private friend circles can follow challenges both participants choose to share. A Python service stores records in SQLite and serves a TypeScript single-page app.

**Status:** DEFERRED (2026-10-25) — paused while the portfolio focuses on Gaze Navigator, Clothing Studio and Karaoke Studio. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **Propose and agree:** title, description, success criteria, evidence rule, deadline and nonmonetary stake. The opponent claims a seat via a one-use invitation, then accepts or declines; the proposer can revise terms before acceptance, and acceptance freezes them.
- **Evidence:** append-only text entries with an optional link and optional photo (PNG/JPEG normalized in the browser to a JPEG of at most 1024×1024 and 512 KiB, reviewed before posting). Entries after the deadline are marked late.
- **Resolution:** either participant proposes a winner; the other agrees or disputes. A mutual void offer is always available.
- **Arbitration:** during a dispute, one participant nominates an arbiter, the other approves, and the arbiter claims a seat and records a reasoned decision.
- **Records:** JSON export, and a self-contained HTML export with embedded images. Records are immutable once settled.
- **Friend circles:** private invitation-only groups (up to 12 members, 10 circles). A challenge appears in a circle's feed only after both participants share it; members can cheer and comment.
- **Backups:** offline full-library archive create/inspect/restore.
- **Optional HTTPS on a trusted LAN** so participants can use separate devices.

## Known gaps

- It is a local notebook for one host, not a social app: no public hosting, accounts, notifications or discovery. Seats are private links, not verified identities.
- The social record is limited to private circles; there is no wider feed, profiles or history across notebooks.
- Evidence is unverified testimony; links are never fetched and photos are not authenticated.
- Hard caps: 20 challenges per data directory, 40 evidence entries and 8 images per challenge.
- Physical multi-device HTTPS use and mobile browsers are unverified; only Chromium is tested.
- Library archives do not include friend circles.

## Run locally

Requirements: Python 3.11+ on a POSIX system with `fcntl.flock` (Linux is tested), Node.js 22.18+ (CI uses Node 24 and Python 3.11) and npm. Pillow 12.3.0 is the only runtime Python dependency.

```sh
cd apps/friendly-challenges
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
npm ci
npm run build
python3 -m challenges --data-dir ./data --port 8767
```

Open http://127.0.0.1:8767 (the default binding is loopback only). For frontend work, keep the service running and run `npm run dev` in a second terminal; it rebuilds `dist/` on change, then refresh the browser. Use separate browser profiles for each seat. No account, API key or environment variable is required.

**HTTPS on a trusted LAN (optional, Linux only).** Pass all five of `--bind <private or loopback IPv4>`, `--origin https://<address>:<port>`, `--tls-cert`, `--tls-key` and `--setup-token-file` together. The certificate must cover the origin and be trusted by each device; the app never installs or bypasses trust. The TLS key and setup-key file must be regular files owned by the service user with mode 0600; the setup key is 64 lowercase hex characters (e.g. from `secrets.token_hex(32)`) and only authorizes creating challenges. Wildcard, public and IPv6 binds are refused, and proxies are unsupported. Never commit keys or tokens.

**Credentials to keep private:** a private access link lets anyone act as that seat, and the service stores only hashes, so a lost link cannot be recovered. Share invitations, never access links.

## Verify

```sh
python3 -m pip install -r requirements-dev.txt          # Pillow + Ruff
python3 -m unittest discover -s tests -p 'test_*.py' -v # or: npm run test:python (needs openssl)
python3 -m compileall -q challenges tests
ruff check .
npm run lint
npm run typecheck
npm test                                                # TypeScript unit tests
npm run check                                           # test + lint + build
npx playwright install chromium
npm run test:browser                                    # real service on ports 4250 and 4251
```

Set `CHROMIUM_PATH` to use an existing Chromium. CI: `.github/workflows/friendly-challenges.yml`.

Full-library archive commands (run with the service stopped; output and restore paths must not exist; Linux only):

```sh
python -m challenges.backup create --data-dir ./data --output ./notebook.friendly.zip
python -m challenges.backup inspect --archive ./notebook.friendly.zip
python -m challenges.backup restore --archive ./notebook.friendly.zip --data-dir ./restored-data
```

`scripts/smoke_*.py` and `scripts/smoke_source_maximum.mjs` are optional maximum-capacity probes; they are not part of CI.

## Project layout

- `challenges/__main__.py` — CLI entry point and options.
- `challenges/domain.py`, `challenges/store.py` — agreement rules and SQLite record store.
- `challenges/server.py`, `challenges/transport.py`, `challenges/https_server.py` — HTTP API, static serving and HTTPS/LAN transport.
- `challenges/images.py`, `challenges/image_export.py` — evidence JPEG validation and HTML export.
- `challenges/circles.py` — friend circles (separate `circles.sqlite3`).
- `challenges/backup.py`, `challenges/archive_*.py` — library archive create/inspect/restore.
- `src/main.ts`, `src/api.ts`, `src/session.ts`, `src/evidence-image.ts`, `src/circles.ts` — browser app.
- `tests/` — Python `test_*.py`, TypeScript `*.test.ts`, and Playwright specs in `tests/browser/`.

## Data & privacy

All data stays in `--data-dir` on the host: challenge records and evidence JPEGs in SQLite, circles in an owner-only `circles.sqlite3`. Photos are re-encoded in the browser, so the original file, filename and location/device metadata are never uploaded. Browsers keep seat tokens in local storage for that origin; API calls use Bearer headers and there are no public image URLs. Exports contain no access tokens; archives are unencrypted and contain capability hashes, so store them privately. Nothing is sent to any outside service.

## Third-party code

Evidence decoding uses [Pillow](https://python-pillow.org/) 12.3.0, installed from PyPI under its own license.
