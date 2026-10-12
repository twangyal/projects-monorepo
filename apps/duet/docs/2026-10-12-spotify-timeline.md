# Spotify listening timeline — issue #210

## Intended outcome and gap

`docs/PRODUCT_DIRECTION.md` makes Spotify integration and an automatically
maintained shared timeline the main points of Duet. Before this work, Duet had
uploaded-audio rooms and dated text memories only, with no Spotify connection
and no automatic history.

## Provider facts used (2026-10-12)

From Spotify's February 2026 Web API changelog and migration guide (via search;
the developer site itself was unreachable from the development environment):

- `GET /me/player/recently-played` remains available.
- Development-mode apps need an owner with Spotify Premium.
- New apps are limited to 5 users.

Request and response shapes follow the published reference as previously
known, and every reply passes a strict validator. They are not yet confirmed
against the live service.

## Design

- **Authorization**: per seat, Authorization Code with PKCE (S256). The
  operator configures only a public client ID. Scopes are
  `user-read-recently-played` and `user-library-read`. OAuth state is
  single-use, bound to room and seat, and expires after 10 minutes.
- **Callback**: `GET /spotify/callback` is the only exception to the service's
  query-string and cross-site rules. It is GET-only, has a bounded character
  set, and is authenticated by the stored state. A refused or failed
  authorization returns to the room with an explanation.
- **Storage**: `duet/listening.py` keeps connections, imported plays and likes,
  overrides and written entries in `listening.sqlite3` (0600). This is
  separate from the strictly validated room document, so the room, export and
  archive formats are unchanged. Credentials never reach the browser.
- **Sync**: a background thread runs every 600 s, and there is a "Check Spotify
  now" button. Expired access is refreshed and rotated refresh tokens are
  kept. A 429 response backs off per `Retry-After`; revoked access is reported.
  Results that arrive after a disconnect are discarded. Network calls never
  hold storage transactions.
- **Derivation**: `derive_timeline` is a pure function with the definitions
  stated in the README:
  - "both played" never claims they listened together and reports each
    person's own plays, noting plays within 30 minutes;
  - "first time" excludes the history imported at connection and songs
    already liked;
  - favorites are likes added after connecting.
- **Curation**: hide, restore and caption overrides use stable keys, so
  re-ingestion cannot undo them. Written entries are author-owned.
  Disconnecting deletes that person's credential and listening, and deleting a
  room deletes everything for it.
- **UI** (`src/timeline.ts`): replies are validated before rendering, which
  rejects non-Spotify track links. The written-entry form and an open caption
  editor survive the 30 s refresh. More than two first-time songs per person
  per day collapse into a group, and the view fits 390 px screens.

## Verification (2026-10-12, local)

Python 3.11, Node.js 22.22, Chromium 141 via `CHROMIUM_PATH`.

- `python3.11 -m unittest discover -s tests`: 243 tests pass. 17 are new: pure
  derivation, the 0600 credential file, baseline/new/both/favorite sync against
  a loopback fake Spotify, hiding that survives re-sync, token refresh and
  rotation, 429 back-off, revocation, disconnect during a fetch, room deletion,
  manual-entry ownership, client validation, and the full HTTP connect,
  callback, sync, curate and disconnect flow. HTTP tests also check that state
  is single-use, forged state is rejected, query strings and cross-site
  requests elsewhere are still refused, and an unconfigured service explains
  itself.
- `ruff check .`, `npm run check` (23 TypeScript tests, including 4 new reply
  and wording tests), and `npm run typecheck` pass.
- Native Chromium: 3 new end-to-end cases on the real built app and service.
  Two seats connect through the fake's authorize redirect and see "You both
  played … not necessarily together". New plays and likes appear after "Check
  Spotify now"; a hidden entry stays hidden through a re-check and is then
  restored with an accumulated play count. A caption and a written entry are
  shared between seats, and the non-writer cannot delete. The listening reply
  contains no tokens, and disconnecting removes automatic entries and keeps
  written ones. Further cases cover a refused approval and phone width.

## Not established

- The real Spotify service: no Spotify app or account was available.
  Endpoints, scopes and the redirect-URI rules come from documentation, and a
  live connection by the owner is needed.
- Usefulness and relevance of the generated timeline over weeks of real
  listening.
- Photos on memories, including the timeline in library archives, and occasion
  playlists. These are the next milestones.
