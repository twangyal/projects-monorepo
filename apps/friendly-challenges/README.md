# Friendly Challenges

A private local notebook for two people to agree on a friendly challenge, record what happened, and settle the outcome together. Stakes are limited to bragging rights or a few ordinary favors. There is no money, payment processing, betting market or public feed.

The service stores one shared agreement in SQLite. Separate browser profiles hold the proposer, opponent and optional arbiter seats. The browser talks to the real local service; it does not simulate the other participants.

## Run locally

Requirements: Python 3.11+, a POSIX system with `fcntl.flock` (verification uses Linux), Node.js 22.18+ and npm. Runtime Python uses only the standard library. No account, API key, paid service or model download is needed.

```sh
cd apps/friendly-challenges
npm ci
npm run build
python3 -m challenges --data-dir ./data --port 8767
```

Open `http://127.0.0.1:8767`. Keep that process running. For development, run `npm run dev` in a second terminal to rebuild changed browser files, then refresh the page. The Python service serves the built `dist` directory and the API on the same origin. This app deliberately binds only to loopback; it is not an internet deployment or a claim of multi-device operation.

## Try the complete flow

1. **Propose challenge:** enter your name, title, description, success criteria, evidence rule, deadline and nonmonetary stake. Save your private access link, then share the separate opponent invitation with another browser profile on this computer.
2. The opponent uses **Claim opponent seat** with their name. Claiming a seat is separate from accepting the agreement. They inspect the terms and use **Accept these terms**, or decline. Before acceptance, the proposer can revise the terms; a stale browser must review the new version before consenting.
3. Both participants use **Add evidence** for progress or results. The shared activity feed records author, server time and any supplied link. Corrections are additional entries; previous statements cannot be deleted.
4. Either participant uses **Propose result** with a named winner and reason. The other can agree or dispute. Agreement settles the challenge; disagreement opens a dispute without inventing a winner.
5. During a dispute, either participant can nominate an arbiter. The other must approve that exact nomination before an arbiter invitation can be issued. A third browser profile claims the nominated seat and records a reasoned decision. Participants can still settle together while arbitration is pending.
6. **Export record** downloads the terms, evidence and activity as JSON. Reloading or restarting the service with the same data directory preserves the record and existing seat access.

Each seat is a private capability, not a verified identity. Names are labels supplied by the people using the app. Anyone holding an access link can act as its seat; separate browser contexts demonstrate distinct permissions, not that distinct humans are present. Use separate browser profiles for a realistic demonstration. Do not post access or invitation links publicly.

## Agreement and resolution rules

- Acceptance freezes all terms. Every mutation carries the displayed revision; stale consent fails instead of silently applying to changed terms. The UI retains typed drafts when a refresh is required.
- Acceptance closes at the exact deadline. Time passing does not create a winner or alter the challenge status. Evidence at or after the deadline remains allowed and is permanently marked **late**. The server's wall clock is authoritative for this local notebook.
- Evidence is supplied testimony, not verified proof. Optional HTTPS links are validated for their shape and rendered safely; the app never fetches or verifies them.
- A participant cannot confirm their own result. A result, mutual void or arbiter decision becomes final in one transaction; competing later commands cannot settle the record again.
- **Offer to void** is one deliberate, permanent offer: its author agrees it stays available until the challenge ends. The other participant can confirm it later or ignore it. The offer cannot be withdrawn or replaced, and the UI warns before posting it. This preserves a mutual closing route even when other proposal limits are exhausted.
- Before an arbiter claims, either participant may withdraw the nomination; its invitation then stops working. After claim, the appointment cannot be replaced unilaterally or revoked. Both participants can still agree on a result or use the mutual void route.
- Terminal records remain readable and exportable. There is no delete, audit rewrite or undo operation that reverses another participant's consent.

## Access, backups and recovery

The browser keeps up to 20 challenge access tokens in local storage for this origin. Incoming fragments are removed from the address bar; API authentication uses Bearer headers. Invitations are single-use, and each claimed seat receives an independently random token. Reissuing an unused invitation invalidates the old invitation. The database stores capability hashes, so the service cannot recover a lost raw access link for you.

Keep **My private access link** somewhere private before closing a browser that cannot save local storage. A storage failure does not invalidate the current in-memory session. A persistent warning, **Retry saving access** and a navigation warning keep unsaved access visible; losing that session without a recovery link still loses that browser's access. **Forget saved seat** removes only the selected browser credential after confirmation, preserving its server record and other remembered seats. Opening another seat's link in the same profile requires an explicit switch; one browser profile is intended to hold one seat per challenge.

**JSON exports are readable records, not access recovery or server backups.** They contain no access tokens, invitation tokens or stored capability digests, and there is no record-import endpoint. To back up the complete notebook and its valid capabilities, stop the service cleanly and copy its entire data directory. Restore that directory while the service is stopped, then use the original private links. Browser storage alone is not a backup.

The service takes a lifetime lock on its data directory. A second process cannot use it while the first service or its in-flight requests are still active. It rejects symlink data/lock/database paths at startup. It does not promise isolation from a malicious user who already controls the same operating-system account and database files. Corrupt stored records fail visibly instead of being replaced with an empty notebook.

## Bounds

One data directory holds at most 20 challenges, including completed records; nothing is silently evicted. Start a separate directory for another notebook after retaining backups and exports. Each challenge allows 10 terms edits, 40 evidence entries, 10 result proposals, 5 arbiter nominations, and at most 10 invitations per seat category. Responses to permitted proposals and the mutual void route remain available when proposal/evidence quotas are reached.

Names are limited to 40 characters; titles to 100; descriptions, success criteria and reasons to 500; evidence rules to 300; evidence text to 1,000; supplied links to 1,024. Deadlines must be in the future and within 365 days on creation/edit. Requests are limited to 16 KiB; serialized records and exports to 1 MiB. Unknown fields, ambiguous duplicate JSON keys, invalid Unicode/numbers, malformed URLs and invalid stored state are rejected.

There are no attachments, file uploads, automatic evidence previews, identity verification, notifications or public social graph. The local milestone covers the complete agreement-to-resolution experience; remote hosting and broader social features require a separate design.

## Verify

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 -m compileall -q challenges tests
ruff check .
npm run check
npx playwright install chromium
npm run test:browser
```

`npm run check` runs TypeScript unit tests, ESLint, type checking and a production build. Playwright starts the real production Python service with an isolated temporary database on port 4250. To use an existing Chromium executable, set `CHROMIUM_PATH=/path/to/chromium` for the browser test command. Primary acceptance uses actual independent browser contexts and the real service; focused failure tests may intercept requests to reproduce outages and races.

The completed local milestone passes **43 Python tests, 22 TypeScript unit tests and 12 production Chromium tests**, plus Ruff, compilation, ESLint, TypeScript and the Vite production build. A focused rerun also verified the final persistent memory-only warning/retry extension. Independent reviews covered role/transaction boundaries, historical audit replay, HTTP framing/lifetime and browser credential/draft races. Root visually inspected desktop and 390-pixel mobile views and created a real challenge through the production UI. See `docs/runtime-verification.json` for the measured local environment and scope; GitHub issue #30 records durable commits and remote CI.
