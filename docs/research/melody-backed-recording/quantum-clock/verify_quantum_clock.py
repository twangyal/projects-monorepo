"""Replay the fixed retained cohort; metadata integrity, not production acceptance."""
from pathlib import Path
import hashlib
import json
import math

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]


def require(value, message):
    if not value:
        raise ValueError(message)


def integer(value, minimum=0):
    return type(value) is int and minimum <= value <= 2**53 - 1


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quantum(data):
    q = data['quantum']
    count, rows = q['totalCalls'], q['rows']
    require(integer(count, 1), 'invalid process count')
    require(isinstance(rows, list) and len(rows) == min(8, count), 'invalid ring size')
    require([r[0] for r in rows] == list(range(max(1, count-7), count+1)), 'invalid ring sequence')
    for r in rows:
        require(isinstance(r, list) and len(r) == 8, 'invalid ring row')
        require(integer(r[1]) and r[1] <= 3, 'invalid ready/armed flags')
        require(integer(r[2]) and finite(r[3]) and r[3] >= 0, 'invalid entry clock')
        require(integer(r[4]) and r[4] <= 32 and integer(r[5]), 'invalid input shape')
        require(r[6] == r[7] == -1 or integer(r[6]) and finite(r[7]) and r[7] >= 0, 'invalid push clock')
    arm = q['arm']
    if arm is not None:
        require(set(arm) == {'sequence', 'frame', 'time', 'startFrame', 'limitFrame'}, 'invalid arm fields')
        require(integer(arm['sequence']) and arm['sequence'] <= count and integer(arm['frame'])
                and finite(arm['time']) and arm['time'] >= 0 and integer(arm['startFrame'])
                and integer(arm['limitFrame']) and arm['limitFrame'] > arm['startFrame'], 'invalid arm metadata')
    receipt = data['receipt']
    previous = rows[-2] if len(rows) > 1 else None
    last = rows[-1]
    return {'processCalls': count, 'rows': rows, 'arm': arm,
            'repeatedEntryPairs': [[a[0], b[0]] for a, b in zip(rows, rows[1:]) if a[2] == b[2]],
            'entryPushFrameDisagreements': [r[0] for r in rows if r[6] >= 0 and r[2] != r[6]],
            'entryTimeFrameResiduals': [r[3] * data['sampleRate'] - r[2] for r in rows],
            'collectorIncomingMatchesLastPush': None if receipt is None else receipt['incomingStart'] == last[6],
            'collectorPreviousEndMatchesPreviousPush': None if receipt is None or previous is None else receipt['previousEnd'] == previous[6] + previous[5]}


def verify(root=HERE, source_root=REPO):
    root = Path(root)
    manifest = json.loads((root/'manifest.json').read_text())
    require(manifest['protocol'] == {'pagesPerMode': 10, 'plannedStartsPerMode': 20,
                                   'modes': ['baseline', 'instrumented'], 'controls': [44100, 48000],
                                   'workers': 1, 'retries': 0, 'maximumQuantumRows': 8}, 'protocol changed')
    expected_receipts = {f'receipts/{mode}-{row:02}.json' for mode in ['baseline', 'instrumented'] for row in range(10)}
    expected_receipts.update(f'receipts/control-{rate}.json' for rate in [44100, 48000])
    require({str(p.relative_to(root)) for p in (root/'receipts').glob('*.json')} == expected_receipts, 'receipt set changed')
    for name, sha in manifest['files'].items():
        require(digest(root/name) == sha, f'artifact hash changed: {name}')
    for name, sha in manifest['originalSourceHashes'].items():
        require(digest(Path(source_root)/name) == sha, f'shipping source changed: {name}')
    result = {'modes': {}, 'controls': []}
    for mode in ['baseline', 'instrumented']:
        cases = []
        for row in range(10):
            r = json.loads((root/f'receipts/{mode}-{row:02}.json').read_text())
            require(r['mode'] == mode and r['row'] == row, 'case identity changed')
            passed = r['error'] is None and r['stage'] == 'complete'
            require(isinstance(r['checkpoints'], list) and len(r['checkpoints']) <= 2, 'invalid checkpoints')
            observed = r['observed']
            require(observed['requests'] in (1, 2), 'invalid actual starts')
            require(observed['released'] and observed['stopped'] == observed['requests'], 'stream not released')
            if passed:
                require(len(r['checkpoints']) == 2 and r['beforeHash'] == r['afterHash']
                        and isinstance(r['beforeHash'], str) and len(r['beforeHash']) == 64, 'passing case lost backup equality')
            events = r['captured'].get('events', [])
            if mode == 'baseline':
                require(events == [], 'baseline has extra observer')
            else:
                require(not r['captured']['overflow'] and len(events) <= 128, 'observer overflow')
                require([e['sequence'] for e in events] == list(range(len(events))), 'event sequence changed')
            terminals = []
            for e in events:
                if e['kind'] != 'terminal':
                    continue
                data = e['data']
                require(data['type'] == 'terminal-clock-research300' and data['reason'] == 'discontinuous-frames', 'unexpected cohort terminal')
                require(data['ready'] is True and data['armed'] is True and integer(data['sampleRate'], 8000), 'terminal admission metadata')
                receipt = data['receipt']
                require(receipt['site'] in ('clock', 'intersection') and integer(receipt['incomingStart'])
                        and integer(receipt['incomingLength'], 1) and integer(receipt['captured'])
                        and integer(receipt['startFrame']) and receipt['limitFrame'] > receipt['startFrame'], 'invalid collector receipt')
                at = e['sequence']
                require(at+1 < len(events) and events[at+1]['kind'] == 'incoming'
                        and events[at+1]['data'] == {'type': 'error', 'reason': data['reason']}, 'receipt/error ordering changed')
                terminals.append({'eventSequence': at, 'sampleRate': data['sampleRate'], 'receipt': receipt, **quantum(data)})
            checkpoints = [{'label': c['label'], 'recordingAtElapsedCheckpoint': isinstance(c['captureState'], str)
                            and c['captureState'].startswith('Recording ') and c['recordEnabled'] is False,
                            'captureState': c['captureState'], 'notice': c['notice']} for c in r['checkpoints']]
            cases.append({'row': row, 'originalAssertionsPassed': passed, 'stage': r['stage'],
                          'actualStarts': observed['requests'], 'scheduledSources': len(observed['sources']),
                          'backupEqualityObserved': r['afterHash'] is not None and r['beforeHash'] == r['afterHash'],
                          'checkpointRecordingCount': sum(c['recordingAtElapsedCheckpoint'] for c in checkpoints),
                          'checkpoints': checkpoints, 'notice': r['captured']['notice'], 'terminals': terminals})
        result['modes'][mode] = {'originalCasesPassed': sum(c['originalAssertionsPassed'] for c in cases),
                                 'actualStarts': sum(c['actualStarts'] for c in cases),
                                 'recordingCheckpoints': sum(c['checkpointRecordingCount'] for c in cases),
                                 'terminalCount': sum(len(c['terminals']) for c in cases), 'cases': cases}
    for rate in [44100, 48000]:
        c = json.loads((root/f'receipts/control-{rate}.json').read_text())
        require(c['rate'] == rate and c['failure'] is None and c['result']['closed']
                and c['result']['samples'] is None, 'native control outcome changed')
        messages = c['result']['messages']
        index = next(i for i, m in enumerate(messages) if m['type'] == 'terminal-clock-research300')
        data = messages[index]
        require(data['sampleRate'] == rate and data['reason'] == 'invalid-command' and data['receipt'] is None
                and messages[index+1] == {'type': 'error', 'reason': 'invalid-command'}, 'native control protocol changed')
        result['controls'].append({'rate': rate, 'reason': data['reason'], **quantum(data)})
    return result


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2, sort_keys=True))
