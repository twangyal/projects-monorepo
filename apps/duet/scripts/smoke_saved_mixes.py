"""Independent #119 saved-mix maximum. Root owns all service lifetimes.

Phases: prepare -> capture -> root graceful restart -> verify-restart -> root
stop -> archive -> root start restored library -> verify-restored.
No producer Store/model/archive functions calculate any expected value.
Capabilities and private records stay in 0600 files under a fresh 0700 output.
"""
import argparse
from contextlib import contextmanager, nullcontext
import copy
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import struct
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
import wave
import zipfile

APP = Path(__file__).resolve().parents[1]
MAX_EXPORT = 393216
MAX_CORE = 262144
MAX_ROOM = 365429
MAX_RECORDS = 1828169
ID = re.compile(r"[0-9a-f]{32}\Z")
TOKEN = re.compile(r"[0-9a-f]{64}\Z")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value, private=False):
    temporary = path.with_name(path.name + ".new")
    with temporary.open("x", encoding="utf-8") as stream:
        os.chmod(temporary, 0o600 if private else 0o644)
        json.dump(value, stream, ensure_ascii=False, allow_nan=False, indent=2)
        stream.write("\n")
    os.replace(temporary, path)


def read_json(path):
    return json.loads(path.read_text())


def text(prefix, count):
    require(len(prefix) <= count, "Original fixture prefix exceeds its text extent")
    return prefix + "x" * (count - len(prefix))


def original_plan():
    return {"schemaVersion": 1, "issue": 119, "rooms": 5, "tracksPerRoom": 12,
            "mixesPerRoom": 8, "referencesPerMix": 12, "totalMixes": 40,
            "totalReferences": 480, "memoriesPerRoom": 100, "memoryCharacters": 500,
            "labelCharacters": 80, "nameCharacters": 80,
            "audio": {"sourceFormat": "WAV PCM16 mono", "sampleRate": 48000,
                      "frames": 96000, "seconds": 2, "amplitude": 8000,
                      "frequencies": [220 + 7 * index for index in range(60)],
                      "normalized": "Actual unchanged service normalization to 48 kHz stereo Opus",
                      "toneProjectionMinimum": .03},
            "mixOrder": "Slot m rotates the original twelve track IDs left by m",
            "missingReference": "Room 1 deletes original last track only after all mixes/memories exist; reuploads its original waveform as a new ID. Captured labels remain literal and missing in six saved mixes after explicit update of mixes 1 and 8.",
            "limits": ["Actual graph maxima: five rooms, forty mixes, 480 refs, sixty final tracks and 500 memories. Short two-second media; no repeat of sixty 8 MiB/300-second media capacity evidence.",
                       "Names/title/artist are readable literal 80-code-point ASCII; memory text is 500 ASCII code points. The runtime graph does not claim to fill all private/core/export byte caps.",
                       "Escaped C0 worst-case byte arithmetic is independently derived separately; controls in maximum memories would overflow the unchanged core cap.",
                       "One removed source track is replaced, so 61 actual uploads yield sixty final independent normalized audio files; missing saved references never imply archived orphan media.",
                       "Root owns live services, audio generation and CLI/browser execution. This script never starts/stops a service or mints replacement seat credentials.",
                       "Representative trusted two-seat native/audio story is separately owned; this runner proves maximum HTTP/archive durability, not physical-device synchronization."]}


def byte_oracle():
    escaped = "\x01" * 80
    entry = {"trackId": "0" * 32, "title": escaped, "artist": escaped}
    mix = {"id": "1" * 32, "name": escaped, "entries": [entry] * 12}
    mixes = [mix] * 8  # Arithmetic-only shape; duplicate IDs are not admitted fixtures.
    extra = {"savedMixes": mixes, "savedMixesRevision": 9007199254740991}
    values = {"entry": len(encode(entry)), "mix": len(encode(mix)),
              "eightMixArray": len(encode(mixes)), "compactRootFields": len(encode(extra)) - 1,
              "spacedRootFields": len(json.dumps({"existing": 0, **extra}, ensure_ascii=False).encode())
              - len(json.dumps({"existing": 0}, ensure_ascii=False).encode())}
    require(values == {"entry": 1029, "mix": 12903, "eightMixArray": 103233,
                       "compactRootFields": 103285, "spacedRootFields": 103904},
            "Original documented metadata byte arithmetic differs")
    return {**values, "maximumCoreBytes": MAX_CORE, "maximumRoomBytes": MAX_ROOM,
            "maximumExportBytes": MAX_EXPORT, "maximumRecordsBytes": MAX_RECORDS,
            "method": "Independent literal JSON serialization; duplicate IDs only in arithmetic repeated-shape calculation, never submitted"}


def prepare(root):
    root.mkdir(mode=0o700)
    stage = "output-directories"
    try:
        (root / "originals").mkdir(mode=0o700)
        (root / "normalized").mkdir(mode=0o700)
        stage = "original-audio-generation"
        plan = original_plan()
        originals = []
        for index, frequency in enumerate(plan["audio"]["frequencies"]):
            samples = bytearray()
            for frame in range(96000):
                samples.extend(struct.pack("<h", round(8000 * math.sin(2 * math.pi * frequency * frame / 48000))))
            path = root / "originals" / f"tone-{index:02d}.wav"
            with wave.open(str(path), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(48000)
                output.writeframes(samples)
            originals.append({"file": path.name, "frequency": frequency, "bytes": path.stat().st_size,
                              "sourceSha256": digest(path.read_bytes()), "sourcePcmSha256": digest(samples)})
        require(len({item["sourceSha256"] for item in originals}) == 60, "Original sources were not distinct")
        write_json(root / "original-plan.json", plan)
        write_json(root / "original-audio.json", originals)
        stage = "metadata-byte-oracle-and-receipt"
        write_json(root / "verification.json", {"schemaVersion": 1, "issue": 119,
                   "status": "fixtures-prepared-runtime-pending", "originalPlanSha256": digest(encode(plan)),
                   "scriptSha256": digest(Path(__file__).read_bytes()), "originalAudio": originals,
                   "byteOracle": byte_oracle(), "phases": [], "limits": plan["limits"]})
    except Exception as error:
        # Output is newly owned: record only known local stage/type, no URL,
        # credential, raw record, subprocess command or exception traceback.
        try:
            write_json(root / "prepare-failure.json", {
                "schemaVersion": 1, "phase": "prepare", "stage": stage,
                "errorType": type(error).__name__,
                "message": str(error)[:500] if isinstance(error, ValueError)
                else "Preparation refused at a native/local boundary; preserve original files.",
            })
        except OSError:
            pass
        raise


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class Api:
    def __init__(self, origin):
        url = urlsplit(origin)
        require(url.scheme == "http" and url.hostname == "127.0.0.1" and url.port is not None
                and not url.path and not url.query and not url.fragment and not url.username,
                "Use an explicit root-owned http://127.0.0.1:port origin")
        self.origin = origin
        self.opener = build_opener(NoRedirect)
        self.calls = 0

    def call(self, method, path, token=None, payload=None, raw=None, headers=None, expected=200, as_bytes=False):
        body = raw if raw is not None else encode(payload) if payload is not None else None
        supplied = {"Origin": self.origin, **(headers or {})}
        if token is not None:
            require(TOKEN.fullmatch(token), "Invalid private fixture credential shape")
            supplied["Authorization"] = "Bearer " + token
        if payload is not None:
            supplied["Content-Type"] = "application/json"
        request = Request(self.origin + path, data=body, headers=supplied, method=method)
        self.calls += 1
        try:
            response = self.opener.open(request, timeout=75)
        except HTTPError as error:
            response = error
        with response:
            status, kind = response.status, response.headers.get("Content-Type", "")
            data = response.read(8 * 1024 * 1024 + 1)
        # Never interpolate token, URL, body or server error into diagnostic output.
        require(status == expected, f"HTTP request {self.calls} returned {status}; expected {expected}")
        require(len(data) <= 8 * 1024 * 1024, "Actual response exceeded fixture bound")
        return json.loads(data) if kind.startswith("application/json") and not as_bytes else data


def room_path(room, tail=""):
    return "/api/rooms/" + room["id"] + tail


def public(room):
    return {key: value for key, value in room.items() if key not in ("serverTime", "myRole", "activeJob")}


def snapshot(api, room, role="host"):
    result = api.call("GET", room_path(room), room[role])
    require(result["myRole"] == role, "Original seat authority changed")
    return result


def normalized_fact(path, frequency):
    result = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-threads", "1",
                             "-protocol_whitelist", "file", "-f", "ogg", "-i", str(path),
                             "-map", "0:a:0", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le",
                             "-f", "s16le", "pipe:1"], capture_output=True, check=True, timeout=20)
    require(not result.stderr and len(result.stdout) == 96000 * 4, "Complete original normalized PCM extent differs")
    # Independent frequency projection over one full second, no producer audio helper.
    sine = cosine = energy = 0.0
    for frame in range(48000):
        value = int.from_bytes(result.stdout[frame * 4:frame * 4 + 2], "little", signed=True)
        angle = 2 * math.pi * frequency * frame / 48000
        sine += value * math.sin(angle)
        cosine += value * math.cos(angle)
        energy += value * value
    ratio = 2 * (sine * sine + cosine * cosine) / (48000 * energy) if energy else 0
    require(ratio >= .03, "Original normalized tone does not match declared frequency")
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": digest(data), "decodedFrames": 96000,
            "pcmSha256": digest(result.stdout), "declaredFrequency": frequency, "toneProjection": ratio}


def upload(api, room, source, title, artist, role):
    value = api.call("POST", room_path(room, "/tracks"), room[role], raw=source.read_bytes(),
                     headers={"Content-Type": "application/octet-stream",
                              "X-Track-Title": title, "X-Track-Artist": artist}, expected=202)
    job = value["job"]
    deadline = time.monotonic() + 70
    while job["status"] == "running" and time.monotonic() < deadline:
        time.sleep(.1)
        job = api.call("GET", room_path(room, "/jobs/" + job["id"]), room[role])["job"]
    require(job["status"] == "complete", "Actual source normalization did not complete")
    require(ID.fullmatch(job["trackId"]), "Actual uploaded track ID malformed")
    return job["trackId"]


def mix_body(state, **extra):
    return {"playlistRevision": state["playlistRevision"], "savedMixesRevision": state["savedMixesRevision"], **extra}


def assert_mixes(actual, expected):
    require(actual == expected, "Complete saved mix metadata/order/labels differ")
    require(len(actual) == 8 and len({m["id"] for m in actual}) == 8, "Saved mix maximum shape differs")
    for mix in actual:
        require(set(mix) == {"id", "name", "entries"} and len(mix["name"]) == 80
                and len(mix["entries"]) == 12 and len({e["trackId"] for e in mix["entries"]}) == 12,
                "Saved mix exact quota/shape differs")
        for entry in mix["entries"]:
            require(set(entry) == {"trackId", "title", "artist"} and len(entry["title"]) == len(entry["artist"]) == 80,
                    "Captured entry lost labels or invented an availability field")


def private_state(root):
    path = root / "private-state.json"
    require(stat.S_IMODE(path.stat().st_mode) == 0o600, "Private fixture file must stay 0600")
    return read_json(path)


def capture(root, origin):
    require(not (root / "private-state.json").exists(), "Capture refuses existing private fixture state")
    plan = read_json(root / "original-plan.json")
    require(plan == original_plan(), "Frozen original plan changed")
    api = Api(origin)
    api.call("GET", "/api/status")
    state = {"rooms": []}
    originals = read_json(root / "original-audio.json")
    for number in range(5):
        created = api.call("POST", "/api/rooms", payload={"title": text(f"Original saved mixes room {number + 1} ", 80), "name": "Original host"}, expected=201)
        joined = api.call("POST", "/api/rooms/" + created["roomId"] + "/join", payload={"inviteToken": created["inviteToken"], "name": "Original guest"})
        room = {"id": created["roomId"], "host": created["token"], "guest": joined["token"], "usedInvite": created["inviteToken"], "audio": [], "expectedMixes": []}
        state["rooms"].append(room)
        write_json(root / "private-state.json", state, True)
        tracks = []
        for index in range(12):
            source_number = number * 12 + index
            source = root / "originals" / originals[source_number]["file"]
            require(digest(source.read_bytes()) == originals[source_number]["sourceSha256"], "Frozen source waveform changed")
            title = text(f"Original tone {source_number:02d} title ", 80)
            artist = text(f"Original tone {source_number:02d} artist ", 80)
            role = "host" if index % 2 == 0 else "guest"
            track_id = upload(api, room, source, title, artist, role)
            data = api.call("GET", room_path(room, "/tracks/" + track_id + "/audio"), room["host"])
            target = root / "normalized" / f"room-{number}-track-{index}.ogg"
            target.write_bytes(data)
            fact = normalized_fact(target, originals[source_number]["frequency"])
            room["audio"].append({"trackId": track_id, "sourceNumber": source_number, "file": target.name, **fact})
            tracks.append({"trackId": track_id, "title": title, "artist": artist})
            for who, vote in [("host", 1), ("guest", -1)]:
                api.call("PUT", room_path(room, "/ratings/" + track_id), room[who], payload={"rating": vote})
        for index in range(100):
            api.call("POST", room_path(room, "/memories"), room["host" if index % 2 == 0 else "guest"],
                     payload={"trackId": tracks[index % 12]["trackId"], "date": "2026-10-05", "text": text(f"Original memory {index:03d} room {number} ", 500)})
        current = snapshot(api, room)
        require(current["savedMixes"] == [] and current["savedMixesRevision"] == 0, "New room saved library is not empty")
        for slot in range(8):
            ordered = tracks[slot:] + tracks[:slot]
            current = api.call("PUT", room_path(room, "/playlist"), room["host"], payload={"trackIds": [t["trackId"] for t in ordered], "revision": current["playlistRevision"]})
            transport = copy.deepcopy(current["playback"])
            name = text(f"Original named mix room {number} slot {slot} ", 80)
            saved = api.call("POST", room_path(room, "/mixes"), room["host" if slot % 2 == 0 else "guest"], payload=mix_body(current, name=name), expected=201)
            require(ID.fullmatch(saved["mixId"]), "Saved mix ID malformed")
            room["expectedMixes"].append({"id": saved["mixId"], "name": name, "entries": copy.deepcopy(ordered)})
            current = saved["room"]
            require(current["savedMixesRevision"] == slot + 1 and current["playback"] == transport, "Saving a copy changed transport or wrong library revision")
            require(current["playlist"] == [e["trackId"] for e in ordered], "Saving a copy changed current playlist")
        assert_mixes(current["savedMixes"], room["expectedMixes"])
        api.call("POST", room_path(room, "/mixes"), room["host"], payload=mix_body(current, name=text("Overflow ninth mix ", 80)), expected=409)
        after = snapshot(api, room)
        require(public(after) == public(current), "Rejected ninth mix mutated the room")
        current = api.call("POST", room_path(room, "/blend"), room["guest"], payload={"revision": current["playlistRevision"]})
        require(current["playlist"] == [e["trackId"] for e in tracks], "Independent mixed-vote build order differs")
        assert_mixes(current["savedMixes"], room["expectedMixes"])
        mix = room["expectedMixes"][0]
        before = copy.deepcopy(current)
        current = api.call("PUT", room_path(room, "/mixes/" + mix["id"] + "/playlist"), room["guest"], payload=mix_body(current))
        mix["entries"] = copy.deepcopy(tracks)
        require(current["savedMixesRevision"] == before["savedMixesRevision"] + 1 and current["playlistRevision"] == before["playlistRevision"] and current["playback"] == before["playback"], "Explicit saved-copy update changed shared transport")
        old_library_revision = current["savedMixesRevision"]
        current = api.call("PUT", room_path(room, "/mixes/" + mix["id"] + "/name"), room["host"], payload={"name": mix["name"], "savedMixesRevision": old_library_revision})
        require(current["savedMixesRevision"] == old_library_revision + 1, "Explicit identical rename did not increment library revision")
        api.call("PUT", room_path(room, "/mixes/" + mix["id"] + "/name"), room["guest"], payload={"name": text("Stale rejected name ", 80), "savedMixesRevision": old_library_revision}, expected=409)
        require(public(snapshot(api, room)) == public(current), "Rejected stale rename mutated current room")
        if number == 4:
            deleted_mix = room["expectedMixes"][-1]
            old = current
            current = api.call("DELETE", room_path(room, "/mixes/" + deleted_mix["id"]), room["guest"], payload={"savedMixesRevision": current["savedMixesRevision"]})
            require(len(current["savedMixes"]) == 7 and current["savedMixes"] == room["expectedMixes"][:-1], "Deleting one saved mix changed another copy")
            for field in ("playlist", "playlistRevision", "playback", "tracks", "ratings", "memories"):
                require(current[field] == old[field], "Deleting saved mix changed current playlist/audio/votes/memories")
            recreated = api.call("POST", room_path(room, "/mixes"), room["host"], payload=mix_body(current, name=deleted_mix["name"]), expected=201)
            require(recreated["mixId"] != deleted_mix["id"], "Deleted saved mix ID was silently reused")
            room["expectedMixes"][-1] = {"id": recreated["mixId"], "name": deleted_mix["name"], "entries": copy.deepcopy(tracks)}
            current = recreated["room"]
            assert_mixes(current["savedMixes"], room["expectedMixes"])
        selected = room["expectedMixes"][7]
        if number == 0:
            removed = tracks[-1]
            current = api.call("DELETE", room_path(room, "/tracks/" + removed["trackId"]), room["host"], payload={})
            retained = copy.deepcopy(selected)
            api.call("POST", room_path(room, "/mixes/" + selected["id"] + "/load"), room["host"], payload={**mix_body(current), "playbackRevision": current["playback"]["revision"], "availableOnly": False}, expected=409)
            require(snapshot(api, room)["savedMixes"] == room["expectedMixes"], "Missing reference refusal dropped captured labels")
            old = current
            current = api.call("POST", room_path(room, "/mixes/" + selected["id"] + "/load"), room["guest"], payload={**mix_body(current), "playbackRevision": current["playback"]["revision"], "availableOnly": True})
            available = [e["trackId"] for e in retained["entries"] if e["trackId"] != removed["trackId"]]
            require(current["playlist"] == available and current["savedMixesRevision"] == old["savedMixesRevision"], "Available-only load changed saved copy/order")
            require(current["playlistRevision"] == old["playlistRevision"] + 1 and current["playback"] == {"trackId": available[0], "playing": False, "position": 0.0, "revision": old["playback"]["revision"] + 1}, "Available-only load not fresh paused zero")
            replacement = upload(api, room, root / "originals" / originals[11]["file"], removed["title"], removed["artist"], "host")
            data = api.call("GET", room_path(room, "/tracks/" + replacement + "/audio"), room["host"])
            target = root / "normalized" / "room-0-replacement.ogg"
            target.write_bytes(data)
            room["audio"][-1] = {"trackId": replacement, "sourceNumber": 11, "file": target.name, **normalized_fact(target, originals[11]["frequency"])}
            tracks[-1] = {**removed, "trackId": replacement}
            current = snapshot(api, room)
            current = api.call("PUT", room_path(room, "/playlist"), room["host"], payload={"trackIds": [e["trackId"] for e in tracks], "revision": current["playlistRevision"]})
            for who, vote in [("host", 1), ("guest", -1)]:
                current = api.call("PUT", room_path(room, "/ratings/" + replacement), room[who], payload={"rating": vote})
            for position in (0, 7):
                target_mix = room["expectedMixes"][position]
                current = api.call("PUT", room_path(room, "/mixes/" + target_mix["id"] + "/playlist"), room["host"], payload=mix_body(current))
                target_mix["entries"] = copy.deepcopy(tracks)
        old = current
        current = api.call("POST", room_path(room, "/mixes/" + selected["id"] + "/load"), room["guest"], payload={**mix_body(current), "playbackRevision": current["playback"]["revision"], "availableOnly": False})
        require(current["playlist"] == [e["trackId"] for e in selected["entries"]] and current["playlistRevision"] == old["playlistRevision"] + 1, "Full saved load order/revision differs")
        require(current["playback"] == {"trackId": selected["entries"][0]["trackId"], "playing": False, "position": 0.0, "revision": old["playback"]["revision"] + 1}, "Load not explicitly fresh and paused")
        require(current["savedMixesRevision"] == old["savedMixesRevision"], "Load changed saved-library revision")
        assert_mixes(current["savedMixes"], room["expectedMixes"])
        require(len(current["tracks"]) == 12 and len(current["memories"]) == 100, "Final maximum tracks/memories differ")
        room["expectedSnapshot"] = public(current)
        write_json(root / "private-state.json", state, True)
        print(f"Original room {number + 1}: 12 actual normalized tracks, 8 saved mixes and 100 memories", flush=True)
    api.call("POST", "/api/rooms", payload={"title": "Overflow sixth room", "name": "Original host"}, expected=409)
    require(len({a["sha256"] for r in state["rooms"] for a in r["audio"]}) == 60, "Final normalized sources are not distinct")
    return verify_http(root, origin, "capture", api=api)


def verify_http(root, origin, phase, api=None):
    api = api or Api(origin)
    state = private_state(root)
    public_rows, audio_facts, export_facts = [], [], []
    for number, room in enumerate(state["rooms"]):
        for role in ("host", "guest"):
            current = snapshot(api, room, role)
            require(public(current) == room["expectedSnapshot"], "Restart/restore changed original complete public snapshot")
            assert_mixes(current["savedMixes"], room["expectedMixes"])
            for audio in room["audio"]:
                data = api.call("GET", room_path(room, "/tracks/" + audio["trackId"] + "/audio"), room[role])
                require(len(data) == audio["bytes"] and digest(data) == audio["sha256"], "Actual original-seat audio bytes changed")
            raw = api.call("GET", room_path(room, "/export"), room[role], as_bytes=True)
            exported = json.loads(raw)
            expected = {"schemaVersion": 2, **room["expectedSnapshot"]}
            require(exported == expected, "Complete token-free export differs from original literal state")
            require(len(raw) <= MAX_EXPORT and "capabilities" not in exported and "inviteHash" not in exported, "Token-free export exceeded budget/leaked private fields")
            for secret in (room["host"], room["guest"], room["usedInvite"]):
                require(secret.encode() not in raw, "Export exposed a private fixture credential")
            if role == "host":
                path = root / f"{phase}-room-{number}-export.json"
                path.write_bytes(raw)
                export_facts.append({"roomNumber": number, "bytes": len(raw), "sha256": digest(raw)})
        api.call("GET", room_path(room), "0" * 64, expected=401)
        api.call("POST", room_path(room, "/join"), payload={"inviteToken": room["usedInvite"], "name": "No remint"}, expected=409)
        public_rows.append({"roomNumber": number, "snapshotSha256": digest(encode(room["expectedSnapshot"])), "mixes": 8, "references": 96, "memories": 100})
        audio_facts.extend({"roomNumber": number, **{k: a[k] for k in ("bytes", "sha256", "decodedFrames", "pcmSha256", "declaredFrequency")}} for a in room["audio"])
    return {"name": phase, "status": "passed", "httpCalls": api.calls, "rooms": 5, "mixes": 40,
            "references": 480, "audioReads": 120, "exports": 10, "memories": 500,
            "publicSnapshots": public_rows, "audio": audio_facts, "exportArtifacts": export_facts,
            "seatChecks": "Original host/guest Bearer credentials retained; wrong capability refused and used invite cannot mint another seat"}


@contextmanager
def stopped_library(directory):
    lock = os.open(directory / ".server.lock", os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(stat.S_ISREG(os.fstat(lock).st_mode), "Expected original regular service lock")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(lock)


def raw_rooms(directory, unstarted_restore=False):
    # The newly no-clobber-published restore has not yet been opened by any
    # service and correctly contains no runtime lock artifact.
    if unstarted_restore:
        require(not (directory / ".server.lock").exists(), "Restored fixture was unexpectedly started before offline verification")
    for suffix in ("-wal", "-journal"):
        sidecar = directory / ("rooms.sqlite3" + suffix)
        require(not sidecar.exists() or sidecar.stat().st_size == 0, "Offline SQLite sidecar still needs graceful cleanup")
    with nullcontext() if unstarted_restore else stopped_library(directory):
        path = directory / "rooms.sqlite3"
        db = sqlite3.connect(path.absolute().as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            rows = db.execute("SELECT id, document FROM rooms ORDER BY id").fetchall()
        finally:
            db.close()
        require(len(rows) == 5, "Stopped original library has unexpected room count")
        return {room_id: json.loads(document) for room_id, document in rows}


def portable_private(room):
    result = copy.deepcopy(room)
    result["playback"].pop("updatedAt")
    return result


def archive(root, directory, python):
    require(directory.resolve().is_relative_to(root.resolve()), "Use only the new owned fixture library")
    source_before = raw_rooms(directory)
    database = directory / "rooms.sqlite3"
    before_hash = digest(database.read_bytes())
    target, restored = root / "complete-saved-mixes.duet.zip", root / "restored-library"
    require(not target.exists() and not restored.exists(), "Archive phase refuses existing outputs")
    summaries = []
    for arguments in (["create", "--data-dir", str(directory), "--output", str(target)],
                      ["inspect", "--archive", str(target)],
                      ["restore", "--archive", str(target), "--data-dir", str(restored)]):
        result = subprocess.run([python, "-m", "duet.backup", *arguments], cwd=APP, capture_output=True, timeout=310)
        require(result.returncode == 0, "Actual archive CLI phase failed; original private evidence preserved")
        summary = json.loads(result.stdout.splitlines()[0])
        require(summary["schema_version"] == 2 and summary["rooms"] == 5 and summary["tracks"] == 60
                and summary["memories"] == 500 and summary["paired_rooms"] == 5, "Actual CLI summary maximum/version differs")
        summaries.append(summary)
    require(digest(database.read_bytes()) == before_hash and raw_rooms(directory) == source_before,
            "Read-only archive create/inspect/restore mutated original library")
    state = private_state(root)
    with zipfile.ZipFile(target) as container:
        infos = container.infolist()
        require(len(infos) == 62 and all(i.compress_type == zipfile.ZIP_STORED for i in infos), "Complete archive member/dialect mismatch")
        manifest = json.loads(container.read("manifest.json"))
        record_bytes = container.read("rooms.json")
        records = json.loads(record_bytes)
        require(manifest["schemaVersion"] == records["schemaVersion"] == 2 and len(record_bytes) <= MAX_RECORDS, "New envelope versions/records bound differ")
        require({r["id"]: r for r in records["rooms"]} == source_before, "Archive altered complete original private room values")
        for room in state["rooms"]:
            for audio in room["audio"]:
                media = container.read("media/" + room["id"] + "/" + audio["trackId"] + ".ogg")
                require(len(media) == audio["bytes"] and digest(media) == audio["sha256"], "Archive changed complete original Opus bytes")
    restored_rooms = raw_rooms(restored, unstarted_restore=True)
    require(set(restored_rooms) == set(source_before), "Restored room identities changed")
    for room_id, original in source_before.items():
        require(portable_private(restored_rooms[room_id]) == portable_private(original), "Restore changed private capabilities, invitation, mixes, labels, votes or anchor")
        require(not restored_rooms[room_id]["playback"]["playing"], "Restore was not paused")
        core = {k: v for k, v in original.items() if k not in ("savedMixes", "savedMixesRevision")}
        core["schemaVersion"] = 1
        require(len(encode(core)) <= MAX_CORE and len(encode(original)) <= MAX_ROOM, "Complete original core/aggregate metadata bound differs")
    write_json(root / "private-original-records.json", source_before, True)
    return {"name": "archive", "status": "passed", "summaries": summaries,
            "archive": {"file": target.name, "bytes": target.stat().st_size, "sha256": digest(target.read_bytes()),
                        "members": 62, "audioMembers": 60, "savedMixes": 40, "references": 480,
                        "recordsBytes": len(record_bytes)},
            "sourceDatabaseByteIdentityPreserved": True,
            "privateOriginalRolesInviteMixesVotesMemoriesAndAnchorsPreserved": True,
            "privateRecordDigestsPublished": False,
            "allowedRestoreDifference": "Existing paused-anchor updatedAt changes only; original capability and invite hashes checked exactly inside private local comparison"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "capture", "verify-restart", "archive", "verify-restored"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--origin")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--python", default=sys.executable)
    args = parser.parse_args()
    root = args.output.expanduser().absolute()
    if args.phase == "prepare":
        prepare(root)
        print("Original fixtures prepared; runtime remains pending.")
        return
    started = time.monotonic()
    receipt_path = root / "verification.json"
    receipt = read_json(receipt_path)
    try:
        if args.phase == "capture":
            require(args.origin, "Provide the root-owned fresh origin")
            phase = capture(root, args.origin)
        elif args.phase in ("verify-restart", "verify-restored"):
            require(args.origin, "Provide the root-owned restarted origin")
            phase = verify_http(root, args.origin, args.phase)
        else:
            require(args.data_dir, "Provide the stopped original fixture library")
            phase = archive(root, args.data_dir, args.python)
        phase["wallMs"] = (time.monotonic() - started) * 1000
        receipt["phases"].append(phase)
        receipt["scriptSha256"] = digest(Path(__file__).read_bytes())
        receipt["status"] = "passed" if args.phase == "verify-restored" else "phase-passed-awaiting-root-lifecycle"
        write_json(receipt_path, receipt)
        print(json.dumps({"phase": args.phase, "status": "passed", "wallMs": phase["wallMs"]}))
    except Exception as error:
        receipt["status"] = "failed-original-evidence-retained"
        receipt["failure"] = {"phase": args.phase, "wallMs": (time.monotonic() - started) * 1000,
                              "message": str(error)[:500] if isinstance(error, ValueError) else "Acceptance phase refused at external/native boundary; private local fixtures retained.",
                              "errorType": type(error).__name__}
        write_json(receipt_path, receipt)
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Tracebacks/API URLs/private state are intentionally not printed.
        print("Saved mixes maximum did not complete. Preserve its private evidence and inspect the bounded assertions locally.", file=sys.stderr)
        raise SystemExit(2) from None
