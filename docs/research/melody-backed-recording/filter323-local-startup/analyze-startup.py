"""Replay only the retained trace; emit no audio samples or arbitrary page data."""
import hashlib
import json
from pathlib import Path
import zipfile

trace = Path(__file__).with_name("trace.zip")
expected = "ca2cc0f75eecf1697109dae738aba7c9bd01f38744a0370b2a6fb32d73de5f35"
assert hashlib.sha256(trace.read_bytes()).hexdigest() == expected, "Trace identity changed"
with zipfile.ZipFile(trace) as archive:
    rows = [json.loads(line) for line in archive.read("1-trace.trace").splitlines()]
starts = {row["callId"]: row for row in rows if row.get("type") == "before"}
elapsed = []
probes = []
feedback = []
for row in rows:
    if row.get("type") == "after":
        expression = starts.get(row["callId"], {}).get("params", {}).get("expression", "")
        value = row.get("result", {}).get("value", {})
        if expression == "() => window.backed113.elapsed()":
            elapsed.append({"endTimeMs": row["endTime"], "value": value.get("v")})
        elif "requests: p.requests" in expression:
            fields = {item["k"]: item["v"] for item in value.get("o", [])}
            probes.append({"endTimeMs": row["endTime"], "requests": fields["requests"]["n"],
                           "sourceCount": len(fields["sources"]["a"]), "elapsed": fields["elapsed"].get("v")})
    elif row.get("type") == "frame-snapshot" and "audio frames were interrupted" in json.dumps(row):
        feedback.append(row["snapshot"]["timestamp"])
assert len(elapsed) == 7 and all(item["value"] == "-Infinity" for item in elapsed)
assert len(probes) == 3 and [item["requests"] for item in probes] == [0, 0, 1]
assert all(item["sourceCount"] == 0 for item in probes) and feedback
print(json.dumps({"traceSha256": expected, "clock": "Playwright trace monotonic milliseconds; not audio frames",
                  "probes": probes, "elapsedPolls": elapsed, "firstInterruptedFeedbackMs": min(feedback),
                  "limits": "No port/processor frame observations; no failure phase or causal attribution"}, indent=2))
