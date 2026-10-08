"""Optional real maximum-library archive gate (about 1.5 GiB; several minutes).

Uses only the existing service, CLI and independent container/PCM expectations.
The output directory must be new; all original evidence is retained there.
"""

import argparse
import datetime
import hashlib
import json
import math
import os
import pathlib
import signal
import sqlite3
import struct
import subprocess
import sys
import threading
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--directory",
    type=pathlib.Path,
    required=True,
    help="New absent evidence directory on a disk with at least 2 GiB free",
)
args = parser.parse_args()
ROOT = args.directory.expanduser().absolute()
ROOT.mkdir(mode=0o700)
APP = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from duet.media import normalize_audio  # noqa: E402
from duet.server import create_server  # noqa: E402

TARGET = 8 * 1024 * 1024
START = time.monotonic()


def crc(data):
    global TABLE
    value = 0
    for byte in data:
        value = ((value << 8) & 0xFFFFFFFF) ^ TABLE[((value >> 24) ^ byte) & 255]
    return value


TABLE = []
for n in range(256):
    value = n << 24
    for _ in range(8):
        value = ((value << 1) ^ (0x04C11DB7 if value & 0x80000000 else 0)) & 0xFFFFFFFF
    TABLE.append(value)


def pages(raw):
    out, offset = [], 0
    while offset < len(raw):
        assert raw[offset : offset + 4] == b"OggS"
        count = raw[offset + 26]
        end = offset + 27 + count + sum(raw[offset + 27 : offset + 27 + count])
        page = bytearray(raw[offset:end])
        expected = struct.unpack_from("<I", page, 22)[0]
        page[22:26] = bytes(4)
        assert crc(page) == expected
        out.append(bytes(raw[offset:end]))
        offset = end
    assert offset == len(raw)
    return out


def make_page(flags, granule, serial, sequence, laces, body):
    raw = bytearray(
        struct.pack("<4sBBQIIIB", b"OggS", 0, flags, granule, serial, sequence, 0, len(laces))
        + bytes(laces)
        + body
    )
    struct.pack_into("<I", raw, 22, crc(raw))
    return bytes(raw)


def sha(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(65536):
            value.update(chunk)
    return value.hexdigest()


def decoded(path):
    command = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file",
        "-f",
        "ogg",
        "-i",
        str(path),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        "-f",
        "s16le",
        "pipe:1",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    value, size = hashlib.sha256(), 0
    while chunk := process.stdout.read(65536):
        size += len(chunk)
        value.update(chunk)
    diagnostics = process.stderr.read(65536)
    assert process.wait(timeout=10) == 0 and not diagnostics, "original fixture decode failed"
    assert size == 300 * 48000 * 4
    return {"bytes": size, "frames": size // 4, "sha256": value.hexdigest()}


source = ROOT / "original-tone.flac"
subprocess.run(
    [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=300",
        "-ac",
        "1",
        "-c:a",
        "flac",
        "-y",
        str(source),
    ],
    check=True,
    timeout=45,
)
normal = ROOT / "normalized-300s.ogg"
duration = normalize_audio(source, normal, threading.Event(), lambda _: None)
assert duration == 300
original = pages(normal.read_bytes())
assert original[0][27 + original[0][26] :].startswith(b"OpusHead")
assert original[1][27 + original[1][26] :].startswith(b"OpusTags")
tags = original[1][27 + original[1][26] :]
serial = struct.unpack_from("<I", original[0], 14)[0]
base = normal.stat().st_size - len(original[1])


def total(size):
    laces = size // 255 + 1
    return base + size + laces + 27 * math.ceil(laces / 255)


low, high = len(tags), TARGET
while low < high:
    mid = (low + high) // 2
    if total(mid) < TARGET:
        low = mid + 1
    else:
        high = mid
assert total(low) == TARGET, "exact legal padding size unavailable"
packet = tags + bytes(low - len(tags))
all_laces = [255] * (len(packet) // 255) + [len(packet) % 255]
new_tags, body_offset = [], 0
for start in range(0, len(all_laces), 255):
    laces = all_laces[start : start + 255]
    final = start + len(laces) == len(all_laces)
    count = sum(laces)
    new_tags.append(
        make_page(
            0 if start == 0 else 1,
            0 if final else 0xFFFFFFFFFFFFFFFF,
            serial,
            len(new_tags) + 1,
            laces,
            packet[body_offset : body_offset + count],
        )
    )
    body_offset += count
assert body_offset == len(packet)
padded = ROOT / "valid-opus-tags-padded-8mib.ogg"
with padded.open("wb") as out:
    out.write(original[0])
    for page in new_tags:
        out.write(page)
    for page in original[2:]:
        fresh = bytearray(page)
        sequence = struct.unpack_from("<I", fresh, 18)[0]
        struct.pack_into("<I", fresh, 18, sequence + len(new_tags) - 1)
        fresh[22:26] = bytes(4)
        struct.pack_into("<I", fresh, 22, crc(fresh))
        out.write(fresh)
assert padded.stat().st_size == TARGET
assert len(pages(padded.read_bytes())) == len(original) + len(new_tags) - 1
normal_pcm, padded_pcm = decoded(normal), decoded(padded)
assert normal_pcm == padded_pcm
# Use the real initialized service/Store to produce a complete stopped library.
data = ROOT / "original-library"
server = create_server(data, port=0)
server.store.now = lambda: 1_700_000_000.0
try:
    for room_number in range(5):
        created = server.store.create_room(
            f"Archive maximum room {room_number + 1}", "Original host"
        )
        room, host = created["roomId"], created["token"]
        guest = server.store.join_room(room, created["inviteToken"], "Original guest")["token"]
        folder = data / "media" / room
        folder.mkdir()
        tracks = []
        for index in range(12):
            track = f"{room_number * 100 + index + 1:032x}"
            target = folder / f"{track}.ogg"
            # Independent regular copies; avoid hardlink identity shortcuts.
            with padded.open("rb") as src, target.open("xb") as out:
                while chunk := src.read(65536):
                    out.write(chunk)
            server.store.add_track(
                room,
                host if index % 2 == 0 else guest,
                track,
                f"Original track {index + 1}",
                "Fixture artist",
                300,
            )
            server.store.rate(room, host, track, 1 if index % 2 else -1)
            server.store.rate(room, guest, track, -1 if index % 2 else 1)
            tracks.append(track)
        server.store.set_playlist(room, host, list(reversed(tracks)), 0)
        for index in range(100):
            server.store.add_memory(
                room, host if index % 2 == 0 else guest, tracks[index % 12], "2026-10-04", "M" * 500
            )
        server.store.set_playback(room, host, tracks[-1], True, 17.25, 0)
finally:
    server.server_close()
assert not (data / "rooms.sqlite3-wal").exists()
record = {
    "kind": "independently authored maximum fixture; no archive producer imports",
    "rooms": 5,
    "tracks": 60,
    "memoriesPerRoom": 100,
    "durationSecondsPerTrack": 300,
    "audioBytesPerTrack": TARGET,
    "totalMediaBytes": 60 * TARGET,
    "normalizedSource": {"bytes": normal.stat().st_size, "sha256": sha(normal)},
    "exactLimitFixture": {
        "bytes": padded.stat().st_size,
        "sha256": sha(padded),
        "padding": "Legal OpusTags packet padding and rebuilt Ogg pages/CRC; not byte-identical normalizer output",
        "decodedPCM": padded_pcm,
        "matchesOriginalNormalizerPCM": True,
    },
    "preparationSeconds": time.monotonic() - START,
}
(ROOT / "fixture.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record))

# Complete CLI round trip and normal service restarts.
DATA = ROOT / "original-library"
ARCHIVE = ROOT / "maximum-library.zip"
RESTORED = ROOT / "restored-library"
REPORT = {
    "fixture": json.loads((ROOT / "fixture.json").read_text()),
    "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "operations": [],
    "runtime": {"python": sys.version, "sqlite": sqlite3.sqlite_version},
}


def inventory(root):
    values = {}
    for path in sorted(root.rglob("*")):
        info = path.lstat()
        if path.is_file():
            values[str(path.relative_to(root))] = [
                info.st_dev,
                info.st_ino,
                info.st_size,
                info.st_mtime_ns,
                sha(path),
            ]
        elif path.is_dir():
            values[str(path.relative_to(root)) + "/"] = [info.st_dev, info.st_ino, info.st_mtime_ns]
        else:
            raise AssertionError("unexpected fixture filesystem entry")
    return values


def records(root):
    with sqlite3.connect(f"file:{root / 'rooms.sqlite3'}?mode=ro&immutable=1", uri=True) as db:
        return [json.loads(row[0]) for row in db.execute("SELECT document FROM rooms ORDER BY id")]


def command_rss(pid):
    # Some managed Linux environments omit /proc/PID/task/PID/children.
    # Measure the command itself and make no descendant/aggregate RSS claim.
    try:
        for line in pathlib.Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except (OSError, ValueError):
        pass
    return 0


def persist():
    (ROOT / "verification.json").write_text(json.dumps(REPORT, indent=2) + "\n")


def run(name, args):
    log = ROOT / f"{name}.log"
    start = time.monotonic()
    peak = 0
    implementation = {
        str(path.relative_to(APP)): sha(path) for path in sorted((APP / "duet").glob("*.py"))
    }
    with log.open("wb") as output:
        process = subprocess.Popen(
            [sys.executable, "-m", "duet.backup", *args],
            cwd=APP,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        while process.poll() is None:
            peak = max(peak, command_rss(process.pid))
            if time.monotonic() - start > 335:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=10)
                break
            time.sleep(0.025)
    entry = {
        "name": name,
        "command": [sys.executable, "-m", "duet.backup", *args],
        "exitCode": process.returncode,
        "wallSeconds": time.monotonic() - start,
        "sampledPeakCommandRSSKiB": peak,
        "samplingScope": "Command process only; decoder descendants are not measured.",
        "samplingIntervalMs": 25,
        "output": log.read_text(),
        "implementationSHA256": implementation,
    }
    REPORT["operations"].append(entry)
    persist()
    assert process.returncode == 0, f"{name} failed; see private owned operation log"


def retained(original, current, started, ended):
    assert len(original) == len(current) == 5
    for old, new in zip(original, current):
        old_play, new_play = old["playback"], new["playback"]
        assert old_play["playing"] is True and old_play["position"] == 17.25
        assert new_play["playing"] is False
        assert (
            new_play["position"] == old_play["position"]
            and new_play["trackId"] == old_play["trackId"]
        )
        assert new_play["revision"] == old_play["revision"] + 1
        assert started <= new_play["updatedAt"] <= ended
        old_without, new_without = dict(old), dict(new)
        del old_without["playback"]
        del new_without["playback"]
        assert old_without == new_without


before = inventory(DATA)
original = records(DATA)
assert (
    len(original) == 5
    and sum(len(x["tracks"]) for x in original) == 60
    and sum(len(x["memories"]) for x in original) == 500
)
assert not ARCHIVE.exists() and not RESTORED.exists()
run("create", ["create", "--data-dir", str(DATA), "--output", str(ARCHIVE)])
assert inventory(DATA) == before
REPORT["archive"] = {"bytes": ARCHIVE.stat().st_size, "sha256": sha(ARCHIVE)}
run("inspect", ["inspect", "--archive", str(ARCHIVE)])
assert inventory(DATA) == before
start_ms = time.time() * 1000
run("restore", ["restore", "--archive", str(ARCHIVE), "--data-dir", str(RESTORED)])
end_ms = time.time() * 1000
restored = records(RESTORED)
retained(original, restored, start_ms, end_ms)
assert inventory(DATA) == before
assert sha(ARCHIVE) == REPORT["archive"]["sha256"]
media = sorted((RESTORED / "media").rglob("*.ogg"))
assert len(media) == 60
expected = REPORT["fixture"]["exactLimitFixture"]["sha256"]
assert all(path.stat().st_size == 8388608 and sha(path) == expected for path in media)
# Exercise ordinary service initialization/restart without changing archived checkpoints.
ports = []
for _ in range(2):
    server = create_server(RESTORED, port=0)
    ports.append(server.server_port)
    server.server_close()
    retained(original, records(RESTORED), start_ms, time.time() * 1000)
REPORT["assertions"] = {
    "allOriginalFilesAndDirectoriesUnchanged": True,
    "originalEntryCount": len(before),
    "archiveUnchangedByInspectAndRestore": True,
    "everyRestoredAudioExactBytesAndHash": True,
    "roomsAndAllPrivateRecordsPreservedExceptPausedCheckpoint": True,
    "originalPlayingAnchorPausedExactlyOnce": True,
    "noOfflineElapsedTimeApplied": True,
    "normalServiceStartedAndClosedTwice": True,
    "servicePorts": ports,
    "restoredAudioFiles": len(media),
    "restoredMediaBytes": sum(p.stat().st_size for p in media),
}
REPORT["limits"] = [
    "RSS samples the command process only; decoder descendants are not measured. A 25 ms sampler can miss short peaks.",
    "Each operation invokes the actual CLI and complete archive/media validation. Normal service startup is real; native audible/browser acceptance is recorded separately.",
    "8 MiB files use legal OpusTags padding, not exact bytes produced by the normalizer. Independent full decoded PCM equals the original 300-second normalized track.",
    "The original fixture was created through the real service Store with independently assigned synthetic content; it is not a recording of human participants.",
]
REPORT["completedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
persist()
print(
    json.dumps(
        {
            "completed": True,
            "archive": REPORT["archive"],
            "operations": [
                {k: op[k] for k in ("name", "wallSeconds", "sampledPeakCommandRSSKiB")}
                for op in REPORT["operations"]
            ],
            "assertions": REPORT["assertions"],
        }
    )
)
