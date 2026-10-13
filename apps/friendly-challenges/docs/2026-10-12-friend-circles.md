# Friend circles and the shared feed — issue #213

## Intended outcome and gap

The product description says progress and results "can appear in a social feed, creating a record of friendly competition." Until now each challenge was visible only to its own seats. There was no audience, no feed and no way to agree to make a challenge visible.

## Design

- **Circles** (`challenges/circles.py`) live in their own owner-only `circles.sqlite3`. The strictly validated challenge schema, record exports and archive format are unchanged.
  - Members hold random 256-bit capabilities. Only their SHA-256 digests are stored, and they are compared in constant time.
  - Invitations can be rotated by any member.
  - Limits: 10 circles, 12 members and 500 comments.
- **Dual consent.** `share` requires a member capability *and* a seat capability for the challenge. Only `proposer` and `opponent` seats count, and a seat from another challenge is rejected.
  - A challenge becomes visible only when both roles have consented.
  - Before then, the circle reply lists it under `pending` with nothing but its ID and which roles consented. Participants recognise it by ID; other members learn nothing.
  - Either participant withdrawing removes the share, its comments and its cheers.
- **Feed derivation.** `feed_items` is a pure function of the challenge's public state and append-only events. It produces these items:
  - agreed;
  - progress, with a 280-character caption excerpt, a photo flag and a late flag;
  - disputed;
  - declined or withdrawn;
  - settled or voided.

  Images, links, hashes, terms edits, invitations and capabilities are never included. Ties within the same millisecond keep record order.
- **Client** (`src/circle-data.ts`, `src/circles.ts`).
  - Every reply passes a strict validator before rendering, and all text is set with `textContent`.
  - Circle links use `?circle=ID#join=…` and `#member=…`. Their fragment is removed immediately, as with seat links.
  - Memberships are remembered under `friendly-challenges.circles.v1`, up to 10, and damaged storage is left untouched.
  - The open circle refreshes every 4 s and re-renders only when the reply changes, so comment drafts and focus survive.
  - Comment drafts participate in the page's unsent-draft warning.

## Verification (2026-10-12, local)

Python 3.11, Node.js 22, Chromium 141 via `CHROMIUM_PATH`.

- `python3.11 -m unittest discover -s tests`: **202 tests pass**. The 6 new tests in `tests/test_circles.py` cover:
  - the owner-only file mode, and a real `challenges.backup create` run with circles present;
  - one consent revealing nothing, and a forged seat being refused;
  - the full agree, progress and settle feed, including names and stake wording;
  - cheer toggling, an unknown item, comment ownership, withdrawal deleting the conversation, and leaving;
  - invitation rotation, the 12-member limit, a blank name and a forged member;
  - a seat from another challenge being refused;
  - pure derivation of disputes, voids, late photo evidence and excerpts without hashes.
- `npm run check`: **51 TypeScript tests**, ESLint and the production build pass. 4 tests are new: exact link parsing, bounded and non-destructive storage, reply validation with feed wording, and the dual-consent share state. `npm run typecheck` passes.
- `ruff check .` passes.
- Native Chromium: **all 39 cases pass**, 2 of them new. Three browser contexts, with one at 390 px:
  1. Joe proposes and Terry accepts.
  2. Joe creates "Running club"; Terry and Sam join from the invitation, and the fragment is removed.
  3. Joe shares, and Sam still sees nothing.
  4. Terry shares, and the agreement appears in Sam's feed by polling.
  5. Sam cheers (`aria-pressed`) and comments without horizontal scrolling. Terry's new evidence appears as the newest item.
  6. Joe sees "Cheered by Sam" and the comment, but cannot delete it. The raw circle reply contains no 64-hex capability.
  7. Terry withdraws, which empties Sam's feed and comments. Sam leaves, and Joe's member list updates.

  A second case checks that an invalid circle link is removed and explained.

## Not established

- Usefulness with real friend groups over weeks.
- Notifications. The feed is visible only while the circle is open.
- Circles are not included in complete library archives; after a restore, friends need a fresh invitation. This is documented in the README.
- Both participants must be members of the same circle to share into it. A circle cannot follow a challenge with an outside opponent.
