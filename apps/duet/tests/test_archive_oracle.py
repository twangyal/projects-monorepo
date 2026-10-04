"""Independent original records/struct ZIP; expected values predate producer reads."""

import copy
import dataclasses
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import sqlite3
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zipfile
import zlib

from duet import archive_format, archive_state, backup
from duet.archive_common import ArchiveError
from duet.server import create_server
from duet.store import DomainError

ROOM, PENDING, T1, T2, DELETED = ("1" * 32, "2" * 32, "a" * 32, "b" * 32, "c" * 32)


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


HOST, GUEST, WAITING, INVITE, WRONG = [
    digest("original oracle " + name) for name in ("host", "guest", "waiting", "invite", "wrong")
]


def encoded(value):
    return json.dumps(
        value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
    ).encode()


def records():
    paired = {
        "schemaVersion": 1,
        "id": ROOM,
        "title": "Private original duet 日本",
        "createdAt": 1000,
        "profiles": {"host": {"name": "Original host"}, "guest": {"name": "Original guest"}},
        "capabilities": {"host": digest(HOST), "guest": digest(GUEST)},
        "inviteHash": None,
        "tracks": [
            {
                "id": track,
                "title": title,
                "artist": "",
                "duration": 1.25,
                "uploadedBy": role,
                "createdAt": when,
            }
            for track, title, role, when in [
                (T2, "Second, first in source", "guest", 2000),
                (T1, "First, second in source", "host", 1500),
            ]
        ],
        "ratings": {T1: {"host": 1, "guest": -1}, T2: {"host": -1, "guest": 1}},
        "playlist": [T2, T1],
        "playlistRevision": 11,
        "playback": {
            "trackId": T2,
            "playing": True,
            "position": 0.375,
            "revision": 17,
            "updatedAt": 3000,
        },
        "memories": [
            {
                "id": "d" * 32,
                "trackId": DELETED,
                "trackTitle": "Retained deleted song",
                "date": "2024-02-29",
                "text": "Original removed-track memory",
                "author": "guest",
                "createdAt": 2100,
            },
            {
                "id": "e" * 32,
                "trackId": T1,
                "trackTitle": "Title at memory creation",
                "date": "1900-01-01",
                "text": "Original host memory",
                "author": "host",
                "createdAt": 2200,
            },
        ],
    }
    pending = {
        "schemaVersion": 1,
        "id": PENDING,
        "title": "Original pending room",
        "createdAt": 4000,
        "profiles": {"host": {"name": "Waiting host"}, "guest": None},
        "capabilities": {"host": digest(WAITING), "guest": None},
        "inviteHash": digest(INVITE),
        "tracks": [],
        "ratings": {},
        "playlist": [],
        "playlistRevision": 4,
        "memories": [],
        "playback": {
            "trackId": None,
            "playing": False,
            "position": 0,
            "revision": 7,
            "updatedAt": 4500,
        },
    }
    return {"schemaVersion": 1, "kind": "duet-library-records", "rooms": [paired, pending]}


def literal_zip(rooms, media=(), manifest_change=None):
    """Literal exact headers and independent CRC/SHA; no producer/ZipFile writer."""
    payloads = [("rooms.json", rooms), *sorted(media)]
    manifest = {
        "schemaVersion": 1,
        "kind": "duet-library",
        "createdAtMs": 123456789,
        "playbackPolicy": "saved-anchor-paused",
        "members": [
            {"name": name, "bytes": len(data), "sha256": digest(data)} for name, data in payloads
        ],
    }
    if manifest_change:
        manifest_change(manifest)
    payloads.insert(0, ("manifest.json", encoded(manifest)))
    local, central = bytearray(), bytearray()
    for name, data in payloads:
        name = name.encode("ascii")
        offset, crc = len(local), zlib.crc32(data)
        local += (
            struct.pack(
                "<IHHHHHIIIHH", 0x04034B50, 20, 0, 0, 0, 33, crc, len(data), len(data), len(name), 0
            )
            + name
            + data
        )
        central += (
            struct.pack(
                "<IHHHHHHIIIHHHHHII",
                0x02014B50,
                0x0314,
                20,
                0,
                0,
                0,
                33,
                crc,
                len(data),
                len(data),
                len(name),
                0,
                0,
                0,
                0,
                (stat.S_IFREG | 0o600) << 16,
                offset,
            )
            + name
        )
    return bytes(
        local
        + central
        + struct.pack(
            "<IHHHHIIH", 0x06054B50, 0, 0, len(payloads), len(payloads), len(central), len(local), 0
        )
    )


def checkpoint(root):
    result = {}
    for path in [root, *sorted(root.rglob("*"))]:
        info = path.lstat()
        result[str(path.relative_to(root))] = (
            info.st_ino,
            info.st_mode,
            info.st_size,
            info.st_mtime_ns,
            digest(path.read_bytes()) if path.is_file() else None,
        )
    return result


def db_rows(path):
    with sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True) as connection:
        return [
            json.loads(document)
            for _, document in connection.execute("SELECT id,document FROM rooms ORDER BY id")
        ]


class ArchiveOracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.media_temp = tempfile.TemporaryDirectory(prefix="duet-oracle-media-")
        output = Path(cls.media_temp.name) / "original.ogg"
        # Exactly60,000 original stereo frames; real local Opus, never fake audio.
        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=337:sample_rate=48000:duration=1.25",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-c:a",
                "libopus",
                "-b:a",
                "64000",
                "-threads",
                "1",
                str(output),
            ],
            check=True,
            timeout=15,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        cls.audio = output.read_bytes()

    @classmethod
    def tearDownClass(cls):
        cls.media_temp.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="duet-archive-oracle-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.options = {"cancel": threading.Event(), "deadline": time.monotonic() + 60}

    def file(self, name, value):
        path = self.root / name
        path.write_bytes(value)
        return path

    def source(self):
        source = self.root / "source"
        source.mkdir()
        (source / ".server.lock").write_bytes(b"")
        (source / ".jobs").mkdir()
        media = source / "media" / ROOM
        media.mkdir(parents=True)
        for track in (T1, T2):
            (media / f"{track}.ogg").write_bytes(self.audio)
        (source / "media" / PENDING).mkdir()
        with sqlite3.connect(source / "rooms.sqlite3") as connection:
            connection.execute("CREATE TABLE rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL)")
            for room in records()["rooms"]:
                connection.execute(
                    "INSERT INTO rooms VALUES (?,?)",
                    (room["id"], json.dumps(room, ensure_ascii=False, indent=2)),
                )
        return source

    def archive(self, name="literal.zip", envelope=None, audio=None):
        return self.file(
            name,
            literal_zip(
                encoded(envelope or records()),
                [
                    (f"media/{ROOM}/{track}.ogg", self.audio if audio is None else audio)
                    for track in (T1, T2)
                ],
            ),
        )

    def test_literal_private_records_keep_source_order_seats_deleted_memories(self):
        envelope = records()
        envelope["rooms"].reverse()
        result = archive_state.validate_rooms(encoded(envelope), **self.options)
        self.assertEqual(result.rooms_json, encoded(records()))
        self.assertEqual(result.room_ids, (ROOM, PENDING))
        self.assertEqual(
            [(t.room_id, t.track_id, t.duration) for t in result.tracks],
            [(ROOM, T1, 1.25), (ROOM, T2, 1.25)],
        )
        self.assertEqual(
            (result.memory_count, result.paired_rooms, result.pending_invites), (2, 1, 1)
        )
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.memory_count = 0

    def test_original_anchor_pauses_once_without_elapsed_time_or_mutating_records(self):
        result = archive_state.validate_rooms(encoded(records()), **self.options)
        original = result.rooms_json
        restored = json.loads(archive_state.paused_rooms(result, 900000000000, **self.options))
        expected = records()
        expected["rooms"][0]["playback"].update(playing=False, revision=18, updatedAt=900000000000)
        expected["rooms"][1]["playback"]["updatedAt"] = 900000000000
        self.assertEqual(restored, expected)
        self.assertEqual(result.rooms_json, original)
        twice = json.loads(
            archive_state.paused_rooms(
                archive_state.validate_rooms(encoded(restored), **self.options),
                900000000001,
                **self.options,
            )
        )
        self.assertEqual([r["playback"]["revision"] for r in twice["rooms"]], [18, 7])
        self.assertEqual(twice["rooms"][0]["playback"]["position"], 0.375)

    def test_safe_revision_edges_refuse_overflow_and_preserve_paused_maximum(self):
        envelope = records()
        envelope["rooms"][0]["playback"].update(playing=False, revision=2**53 - 1)
        envelope["rooms"][0]["playlistRevision"] = 2**53 - 1
        result = archive_state.validate_rooms(encoded(envelope), **self.options)
        paused = json.loads(archive_state.paused_rooms(result, 9999, **self.options))
        self.assertEqual(paused["rooms"][0]["playback"]["revision"], 2**53 - 1)
        for value in (2**53, True, 1.0):
            bad = records()
            bad["rooms"][0]["playlistRevision"] = value
            with self.subTest(value=value), self.assertRaises(ArchiveError):
                archive_state.validate_rooms(encoded(bad), **self.options)
        envelope["rooms"][0]["playback"]["playing"] = True
        with self.assertRaises(ArchiveError):
            result = archive_state.validate_rooms(encoded(envelope), **self.options)
            archive_state.paused_rooms(result, 9999, **self.options)

    def test_private_relations_reject_ambiguous_consent_and_unknown_fields(self):
        mutations = [
            lambda r: r[0].update(inviteHash=digest(INVITE)),
            lambda r: r[1]["capabilities"].update(guest=digest(GUEST)),
            lambda r: r[0]["profiles"].update(guest=None),
            lambda r: r[0]["ratings"][T1].update(host=True),
            lambda r: r[0]["playlist"].append(T1),
            lambda r: r[0]["ratings"].pop(T2),
            lambda r: r[0]["memories"][0].update(date="2023-02-29"),
            lambda r: r[0]["memories"][0].update(author="third"),
            lambda r: r[0].update(blend=[]),
            lambda r: r[0]["playback"].update(trackId=DELETED),
        ]
        for index, mutation in enumerate(mutations):
            bad = records()
            mutation(bad["rooms"])
            with self.subTest(mutation=index), self.assertRaises(ArchiveError):
                archive_state.validate_rooms(encoded(bad), **self.options)
        self.assertEqual(
            archive_state.validate_rooms(encoded(records()), **self.options).memory_count, 2
        )

    def test_json_and_room_count_admission_is_strict(self):
        valid = encoded(records())
        bad_values = [
            valid.replace(b'"schemaVersion":1', b'"schemaVersion":1,"schemaVersion":1', 1),
            valid.replace(b'"position":0.375', b'"position":NaN', 1),
            valid.replace(b"Original host", b"\\ud800", 1),
            b"\xef\xbb\xbf" + valid,
            b"[" * 33 + b"0" + b"]" * 33,
        ]
        for index, bad in enumerate(bad_values):
            with self.subTest(value=index), self.assertRaises(ArchiveError):
                archive_state.validate_rooms(bad, **self.options)
        many = records()
        many["rooms"] = []
        for index in range(6):
            room = copy.deepcopy(records()["rooms"][1])
            room["id"] = f"{index + 1:032x}"
            many["rooms"].append(room)
        with self.assertRaises(ArchiveError):
            archive_state.validate_rooms(encoded(many), **self.options)

    def test_pinned_read_nonmutating_and_fresh_database_rebuild_exact(self):
        source = self.source()
        before = checkpoint(source)
        with (source / "rooms.sqlite3").open("rb") as stream:
            result = archive_state.read_library(stream.fileno(), **self.options)
        self.assertEqual(result.rooms_json, encoded(records()))
        self.assertEqual(checkpoint(source), before)
        target = self.root / "new"
        target.mkdir()
        fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY)
        try:
            archive_state.write_database(fd, result.rooms_json, **self.options)
            self.assertEqual(db_rows(target / "rooms.sqlite3"), records()["rooms"])
            self.assertEqual(sorted(p.name for p in target.iterdir()), ["rooms.sqlite3"])
            before = (target / "rooms.sqlite3").read_bytes()
            with self.assertRaises(ArchiveError):
                archive_state.write_database(fd, result.rooms_json, **self.options)
            self.assertEqual((target / "rooms.sqlite3").read_bytes(), before)
        finally:
            os.close(fd)

    def test_literal_container_offsets_hashes_copy_match_original_bytes(self):
        archive = self.archive()
        with archive.open("rb") as stream:
            index = archive_format.read_index(stream.fileno(), **self.options)
            self.assertEqual(index.created_at_ms, 123456789)
            self.assertEqual(
                [e.name for e in index.entries],
                ["manifest.json", "rooms.json", f"media/{ROOM}/{T1}.ogg", f"media/{ROOM}/{T2}.ogg"],
            )
            self.assertEqual(
                archive_format.read_rooms(stream.fileno(), index, **self.options),
                encoded(records()),
            )
            for member in index.members:
                wanted = encoded(records()) if member.name == "rooms.json" else self.audio
                self.assertEqual((member.size, member.sha256), (len(wanted), digest(wanted)))
                with (self.root / "copied").open("wb") as output:
                    archive_format.copy_member(
                        stream.fileno(), index, member.name, output.fileno(), **self.options
                    )
                self.assertEqual((self.root / "copied").read_bytes(), wanted)

    def test_container_rejects_layout_and_integrity_tampering(self):
        original = self.archive().read_bytes()
        flags = bytearray(original)
        struct.pack_into("<H", flags, 6, 8)
        count = bytearray(original)
        struct.pack_into("<H", count, len(original) - 12, 63)
        attributes = bytearray(original)
        offset = struct.unpack_from("<I", original, len(original) - 6)[0]
        struct.pack_into("<I", attributes, offset + 38, (stat.S_IFLNK | 0o600) << 16)
        crc = bytearray(original)
        crc[original.index(b"Original removed-track memory")] ^= 1
        wrong_sha = literal_zip(
            encoded(records()),
            [(f"media/{ROOM}/{t}.ogg", self.audio) for t in (T1, T2)],
            lambda m: m["members"][0].update(sha256="0" * 64),
        )
        for index, data in enumerate(
            [
                b"prefix" + original,
                original + b"trailing",
                original[:-1],
                flags,
                count,
                attributes,
                crc,
                wrong_sha,
            ]
        ):
            path = self.file(f"tamper-{index}.zip", data)
            with (
                self.subTest(tamper=index),
                path.open("rb") as stream,
                self.assertRaises(ArchiveError),
            ):
                admitted = archive_format.read_index(stream.fileno(), **self.options)
                archive_format.read_rooms(stream.fileno(), admitted, **self.options)

    def test_create_inspect_keep_source_bytes_and_original_playing_anchor(self):
        source = self.source()
        before = checkpoint(source)
        output = self.root / "created.zip"
        created = backup.create_archive(source, output)
        inspected = backup.inspect_archive(output)
        self.assertEqual(dataclasses.asdict(created), dataclasses.asdict(inspected))
        self.assertEqual(
            (
                created.rooms,
                created.tracks,
                created.memories,
                created.paired_rooms,
                created.pending_invites,
            ),
            (2, 2, 2, 1, 1),
        )
        self.assertEqual(created.media_bytes, len(self.audio) * 2)
        self.assertEqual(created.archive_bytes, output.stat().st_size)
        self.assertEqual(created.playback_policy, "saved-anchor-paused")
        self.assertEqual(checkpoint(source), before)
        with zipfile.ZipFile(output) as container:
            self.assertEqual(container.read("rooms.json"), encoded(records()))
            self.assertEqual(
                container.namelist(),
                ["manifest.json", "rooms.json", f"media/{ROOM}/{T1}.ogg", f"media/{ROOM}/{T2}.ogg"],
            )
            for item in container.infolist():
                self.assertEqual(
                    (item.compress_type, item.flag_bits, item.extra, item.comment), (0, 0, b"", b"")
                )
                self.assertEqual(item.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(item.external_attr, (stat.S_IFREG | 0o600) << 16)
            for token in (HOST, GUEST, WAITING, INVITE):
                self.assertNotIn(token.encode(), container.read("rooms.json"))
            for track in (T1, T2):
                self.assertEqual(container.read(f"media/{ROOM}/{track}.ogg"), self.audio)

    def test_restored_anchor_private_seats_survive_normal_startup_twice(self):
        archive = self.archive()
        target = self.root / "restored"
        backup.restore_archive(archive, target)
        restored = db_rows(target / "rooms.sqlite3")
        expected = records()["rooms"]
        expected[0]["playback"].update(playing=False, revision=18)
        timestamp = restored[0]["playback"]["updatedAt"]
        self.assertGreater(timestamp, 3000)
        for room in expected:
            room["playback"]["updatedAt"] = timestamp
        self.assertEqual(restored, expected)
        for restart in range(2):
            with self.subTest(restart=restart):
                server = create_server(target, port=0)
                try:
                    state = server.store.snapshot(ROOM, HOST)
                    self.assertEqual(
                        state["playback"],
                        {"trackId": T2, "playing": False, "position": 0.375, "revision": 18},
                    )
                    self.assertEqual(server.store.authenticate(ROOM, GUEST), "guest")
                    self.assertEqual(state["memories"], expected[0]["memories"])
                    self.assertEqual(state["ratings"], expected[0]["ratings"])
                    self.assertEqual(state["playlist"], [T2, T1])
                    with self.assertRaises(DomainError) as conflict:
                        server.store.set_playback(ROOM, HOST, T2, True, 0.375, 17)
                    self.assertEqual(conflict.exception.status, 409)
                finally:
                    server.server_close()

    def test_cli_to_real_http_retains_roles_invite_once_and_audio_ranges(self):
        archive = self.archive()
        target = self.root / "cli-restored"
        command = [
            sys.executable,
            "-m",
            "duet.backup",
            "restore",
            "--archive",
            str(archive),
            "--data-dir",
            str(target),
        ]
        result = subprocess.run(command, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        summary = result.stdout + result.stderr
        for private in (HOST, GUEST, INVITE, digest(HOST), "Original host", str(archive)):
            self.assertNotIn(private.encode(), summary)
        self.assertIn(b"link", summary.lower())
        server = create_server(target, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(method, path, body=None, token=None, headers=None):
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            values = {"Origin": f"http://127.0.0.1:{server.server_port}", **(headers or {})}
            if token:
                values["Authorization"] = f"Bearer {token}"
            if body is not None:
                body = encoded(body)
                values["Content-Type"] = "application/json"
            try:
                connection.request(method, path, body, values)
                response = connection.getresponse()
                data = response.read()
                return response.status, json.loads(data) if response.getheader(
                    "Content-Type", ""
                ).startswith("application/json") else data
            finally:
                connection.close()

        try:
            for token, role in [(HOST, "host"), (GUEST, "guest")]:
                status, room = request("GET", f"/api/rooms/{ROOM}", token=token)
                self.assertEqual(status, 200)
                self.assertEqual(room["myRole"], role)
                self.assertEqual(room["playback"]["position"], 0.375)
                self.assertNotIn("capabilities", room)
                self.assertNotIn("inviteHash", room)
            self.assertEqual(request("GET", f"/api/rooms/{ROOM}", token=WRONG)[0], 401)
            self.assertEqual(
                request(
                    "POST", f"/api/rooms/{ROOM}/join", {"inviteToken": INVITE, "name": "Wrong seat"}
                )[0],
                409,
            )
            self.assertEqual(
                request(
                    "POST",
                    f"/api/rooms/{PENDING}/join",
                    {"inviteToken": WRONG, "name": "Wrong invitation"},
                )[0],
                401,
            )
            status, joined = request(
                "POST",
                f"/api/rooms/{PENDING}/join",
                {"inviteToken": INVITE, "name": "Original invited person"},
            )
            self.assertEqual(status, 200)
            self.assertEqual(
                request("GET", f"/api/rooms/{PENDING}", token=joined["token"])[1]["myRole"], "guest"
            )
            self.assertEqual(
                request(
                    "POST", f"/api/rooms/{PENDING}/join", {"inviteToken": INVITE, "name": "Replay"}
                )[0],
                409,
            )
            self.assertEqual(
                request("GET", f"/api/rooms/{ROOM}/tracks/{T1}/audio", token=HOST),
                (200, self.audio),
            )
            self.assertEqual(
                request(
                    "GET",
                    f"/api/rooms/{ROOM}/tracks/{T1}/audio",
                    token=GUEST,
                    headers={"Range": "bytes=17-52"},
                ),
                (206, self.audio[17:53]),
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(3)
        before = checkpoint(target)
        again = subprocess.run(command, capture_output=True, timeout=10)
        self.assertEqual(again.returncode, 2)
        self.assertEqual(checkpoint(target), before)

    def test_existing_output_destination_and_source_descendant_never_overwritten(self):
        source = self.source()
        before = checkpoint(source)
        existing = self.file("keep.zip", b"original unrelated output")
        with self.assertRaises(ArchiveError):
            backup.create_archive(source, existing)
        self.assertEqual(existing.read_bytes(), b"original unrelated output")
        with self.assertRaises(ArchiveError):
            backup.create_archive(source, source / "nested.zip")
        self.assertEqual(checkpoint(source), before)
        archive = self.archive()
        destination = self.root / "empty"
        destination.mkdir()
        with self.assertRaises(ArchiveError):
            backup.restore_archive(archive, destination)
        self.assertEqual(list(destination.iterdir()), [])

    def test_running_lock_and_nonempty_wal_reject_without_source_mutation(self):
        source = self.source()
        before = checkpoint(source)
        with (source / ".server.lock").open("rb") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(ArchiveError) as failure:
                backup.create_archive(source, self.root / "busy.zip")
            self.assertEqual(failure.exception.code, "busy")
        self.assertEqual(checkpoint(source), before)
        (source / "rooms.sqlite3-wal").write_bytes(b"original unapplied WAL evidence")
        before = checkpoint(source)
        with self.assertRaises(ArchiveError):
            backup.create_archive(source, self.root / "wal.zip")
        self.assertEqual(checkpoint(source), before)
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ["source"])

    def test_pre_cancelled_operations_publish_nothing(self):
        source = self.source()
        archive = self.archive()
        before = checkpoint(source)
        cancel = threading.Event()
        cancel.set()
        operations = [
            lambda: backup.create_archive(source, self.root / "cancel.zip", cancel=cancel),
            lambda: backup.inspect_archive(archive, cancel=cancel),
            lambda: backup.restore_archive(archive, self.root / "cancelled", cancel=cancel),
        ]
        for operation in operations:
            with self.assertRaises(ArchiveError) as failure:
                operation()
            self.assertEqual(failure.exception.code, "cancelled")
        self.assertEqual(checkpoint(source), before)
        self.assertEqual(
            sorted(path.name for path in self.root.iterdir()), ["literal.zip", "source"]
        )

    def test_destination_created_during_fsync_is_preserved_and_only_owned_stage_removed(self):
        archive = self.archive()
        target = self.root / "raced"
        original_fsync = os.fsync
        injected = False

        def sync_then_race(fd):
            nonlocal injected
            original_fsync(fd)
            if not injected and stat.S_ISREG(os.fstat(fd).st_mode):
                injected = True
                target.mkdir()
                (target / "keep").write_bytes(
                    b"concurrent destination belongs to another operation"
                )

        with patch("os.fsync", side_effect=sync_then_race), self.assertRaises(ArchiveError):
            backup.restore_archive(archive, target)
        self.assertTrue(injected, "Must actually race after staging, not fail at initial admission")
        self.assertEqual(
            (target / "keep").read_bytes(), b"concurrent destination belongs to another operation"
        )
        self.assertEqual(
            sorted(path.name for path in self.root.iterdir()), ["literal.zip", "raced"]
        )

    def test_cancellation_after_a_real_staged_file_sync_publishes_no_directory(self):
        archive = self.archive()
        target = self.root / "cancel-late"
        cancel = threading.Event()
        original_fsync = os.fsync

        def sync_then_cancel(fd):
            original_fsync(fd)
            if stat.S_ISREG(os.fstat(fd).st_mode):
                cancel.set()

        with (
            patch("os.fsync", side_effect=sync_then_cancel),
            self.assertRaises(ArchiveError) as error,
        ):
            backup.restore_archive(archive, target, cancel=cancel)
        self.assertTrue(cancel.is_set(), "Must reach actual stage durability before cancellation")
        self.assertEqual(error.exception.code, "cancelled")
        self.assertFalse(target.exists())
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ["literal.zip"])

    def test_media_membership_requires_exact_active_tracks_not_deleted_memory_audio(self):
        for index, tracks in enumerate([(T1,), (T1, T2, DELETED)]):
            archive = self.file(
                f"membership-{index}.zip",
                literal_zip(
                    encoded(records()),
                    [(f"media/{ROOM}/{track}.ogg", self.audio) for track in tracks],
                ),
            )
            with self.subTest(case=index), self.assertRaises(ArchiveError):
                backup.inspect_archive(archive)
            destination = self.root / f"membership-{index}"
            with self.assertRaises(ArchiveError):
                backup.restore_archive(archive, destination)
            self.assertFalse(destination.exists())

    def test_valid_zip_wrong_duration_or_missing_ogg_eos_never_restores(self):
        wrong = records()
        wrong["rooms"][0]["tracks"][0]["duration"] = 2.0
        first = self.archive("wrong-duration.zip", envelope=wrong)
        offset, pages = 0, []
        while offset < len(self.audio):
            self.assertEqual(self.audio[offset : offset + 4], b"OggS")
            count = self.audio[offset + 26]
            end = offset + 27 + count + sum(self.audio[offset + 27 : offset + 27 + count])
            pages.append((offset, end))
            offset = end
        second = self.archive("no-eos.zip", audio=self.audio[: pages[-1][0]])
        for index, archive in enumerate([first, second]):
            with self.subTest(case=index), self.assertRaises(ArchiveError):
                backup.inspect_archive(archive)
            target = self.root / f"reject-{index}"
            with self.assertRaises(ArchiveError):
                backup.restore_archive(archive, target)
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
