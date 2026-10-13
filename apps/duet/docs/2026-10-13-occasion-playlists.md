# Occasion playlists from the shared timeline — issue #220

## Intended outcome and gap

`docs/PRODUCT_DIRECTION.md` names playlists among the features that support Duet's central Spotify timeline. Duet already turned both people's listening into a shared, curated timeline with memories (#210, #212). Getting music *back out* of it required copying songs by hand. Moments like "the songs from our trip" or "everything we wrote a memory for" could not be reached in Spotify.

This milestone closes that gap. Either connected person picks a slice of the curated timeline, previews it, and Duet creates it as a **private playlist in that person's own Spotify account**. Both people see the result in the room.

## Provider facts used (2026-10-13)

Spotify's developer site is unreachable from the development environment. These facts come from search results summarising Spotify's February 2026 Web API changelog and migration guide:

- `POST /users/{user_id}/playlists` is replaced by `POST /me/playlists`.
- `POST /playlists/{id}/tracks` is renamed `POST /playlists/{id}/items`. It still takes `{"uris": [...]}` with at most 100 items and returns a `snapshot_id`.
- Creating a private playlist requires the `playlist-modify-private` scope.

The live service has not been tested; the request and response shapes are verified only against the loopback fake (`tests/fake_spotify.py`), which implements these documented shapes.

## Design

- **Scope**: `playlist-modify-private` is added to the authorization request. Duet stores the scope string that Spotify reports at token exchange and refresh, in a separate `grants` table. The browser sees only `canCreatePlaylists`, never the scope string or any credential.
- **Older connections** lack the grant. The panel says so and offers **Reconnect my Spotify**. Previously, reconnecting always reset that person's imported listening. Now, when the same Spotify account re-authorizes, Duet updates only the credentials and grant and keeps the person's plays, likes, baseline and timeline. A different account still starts a fresh baseline. Without this change, granting the new permission would have erased the person's timeline entries.
- **Selection** (`kinds`, optional `from`/`to` dates, `memoriesOnly`) is validated strictly on the server. It takes the visible automatic entries (`both`, `new`, `favorite`) oldest first, one per song. Hidden entries never enter a playlist, and written entries carry no Spotify track.
- **Creation** order:
  1. Check the connection and grant, and the room limit of 50 playlists. Nothing is sent to Spotify without the grant.
  2. Select the songs. Refuse an empty selection or one over 100 songs.
  3. Refresh access if it has expired.
  4. `POST /me/playlists` with `public: false`, then `POST /playlists/{id}/items`.

  A 403 from Spotify becomes a reconnect explanation. If the playlist is created but its songs are refused, the error says an empty playlist now exists, and nothing is recorded. Network calls happen outside storage transactions.
- **Shared record**: each created playlist (name, owner seat, Spotify link, song count, time) appears for both people. Spotify links are validated to `https://open.spotify.com/playlist/<id>` on both server and client, and open with `noopener noreferrer`. Room deletion removes the records. The playlists in Spotify belong to their owner and are not touched.
- **UI**: the panel is built once, so periodic timeline refreshes never discard a draft name or selection. Any change to the selection clears a stale preview. The layout fits a 390 px phone screen.

## Verification

- Python (`tests/test_listening.py`): selection rules and validation, creation in the requester's account with ordered URIs and `public: false`, refresh before creation, the missing-grant 409 with no Spotify request, 403 and partial-failure handling, same-account re-authorization keeping listening, a different account resetting, disconnect, room deletion, and HTTP routes with authentication.
- TypeScript (`tests/timeline.test.ts`): playlist and preview validation, including rejection of non-Spotify and `javascript:` links.
- Browser (`tests/browser/listening.spec.ts`), against the loopback fake:
  - An older-permission connection is blocked and reconnected without losing entries.
  - The preview is checked, then the playlist is created and read back from the fake's store.
  - The partner sees the playlist, an empty selection is refused, and the panel fits a phone.

## Limits

- Not verified against a live Spotify app: no Premium-owned developer app is available.
- At most 100 songs per playlist (one `items` request) and 50 recorded playlists per room.
- Duet creates playlists but does not update or sync them after creation.
