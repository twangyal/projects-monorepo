"""Independent bounded metadata replay; never decode or infer audio samples."""
import hashlib
import json
import math
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def frame(value):
    return type(value) is int and 0 <= value < 2**53


def analyze(rows, controls):
    require(len(rows) == 10 and [r['row'] for r in rows] == list(range(10)), 'Fixed row order/count')
    require(len(controls) == 2 and [c['rate'] for c in controls] == [44100, 48000], 'Fixed controls')
    summary = {'harnessPasses': 0, 'plannedStarts': 20, 'observedArms': 0,
               'scheduledBackingStarts': 0, 'recordingPhases': 0, 'nativeRefusals': 0, 'refusals': []}
    for row in rows:
        captured = row['captured']; events = captured['events']
        require(captured['overflow'] is False and 0 < len(events) <= 128, 'Bounded observation')
        require([e['sequence'] for e in events] == list(range(len(events))), 'Event order')
        walls = [e['wallMs'] for e in events]
        require(all(type(t) in (int, float) and math.isfinite(t) and t >= 0 for t in walls)
                and walls == sorted(walls), 'Monotonic observer clock')
        require(all(type(e['audioTime']) in (int, float) and math.isfinite(e['audioTime'])
                    and e['audioTime'] >= 0 and frame(e['contextId']) for e in events), 'Context metadata')
        passed = row['error'] is None and row['stage'] == 'complete'
        summary['harnessPasses'] += int(passed)
        if passed:
            require(row['beforeHash'] == row['afterHash'] and isinstance(row['beforeHash'], str)
                    and len(row['beforeHash']) == 64, 'Old project identity')
            require(row['observed']['requests'] == 2 and row['observed']['stopped'] == 2
                    and row['observed']['released'] is True, 'Stream ownership')
        arms = [i for i, e in enumerate(events) if e['kind'] == 'outgoing' and e['data']['type'] == 'arm']
        require(len(arms) <= 2, 'At most two intended starts')
        summary['observedArms'] += len(arms)
        for n, at in enumerate(arms):
            arm = events[at]['data']; end = arms[n+1] if n+1 < len(arms) else len(events)
            segment = events[at:end]
            require(set(arm) == {'type', 'startFrame', 'limitFrame'} and frame(arm['startFrame'])
                    and frame(arm['limitFrame']) and arm['limitFrame'] > arm['startFrame'], 'Arm geometry')
            require(any(e['kind'] == 'incoming' and e['data'] == {'type': 'armed',
                    'startFrame': arm['startFrame'], 'limitFrame': arm['limitFrame']} for e in segment), 'Arm acknowledgement')
            sources = [e for e in segment if e['kind'] == 'source-start']
            if sources:
                require([e['frames'] for e in sources] == [441000, 551, 551, 551, 551], 'Unchanged source schedule')
                rate = row['observed']['sources'][n*5]['contextRate']
                require(abs(sources[0]['when']*rate-arm['startFrame']) <= 1, 'Backing start frame')
                require(all(abs(sources[i]['when']-(sources[0]['when']-1+(i-1)*.25)) <= 1/rate for i in range(1,5)), 'Count-in schedule')
                summary['scheduledBackingStarts'] += 1
            summary['recordingPhases'] += int(any(e['kind'] == 'phase' and e['phase'] == 'recording' for e in segment))
        for index, event in enumerate(events):
            if event['kind'] != 'terminal':
                continue
            data = event['data']; receipt = data['receipt']
            require(set(data) == {'type','reason','ready','armed','currentFrame','sampleRate','receipt'}, 'Terminal payload allowlist')
            require(data['type'] == 'terminal-clock-research300' and data['reason'] == 'discontinuous-frames', 'Observed native reason')
            require(type(data['ready']) is bool and type(data['armed']) is bool
                    and frame(data['currentFrame']) and data['sampleRate'] in (44100,48000), 'Processor metadata')
            require(isinstance(receipt,dict) and set(receipt) == {'site','previousEnd','incomingStart','incomingLength','startFrame','limitFrame','captured'}, 'Receipt allowlist')
            for key in ('incomingStart','incomingLength','captured'):
                require(frame(receipt[key]), 'Receipt frame')
            for key in ('previousEnd','startFrame','limitFrame'):
                require(receipt[key] is None or frame(receipt[key]), 'Nullable receipt frame')
            b,p,s = receipt['incomingStart'],receipt['previousEnd'],receipt['startFrame']
            require(b == data['currentFrame'] and receipt['incomingLength'] > 0, 'Incoming frame identity')
            require(data['armed'] == (s is not None), 'Arm state identity')
            if receipt['site'] == 'clock':
                mismatch = p is not None and (b < p if s is None else b != p) or s is not None and p is None and b > s
                require(mismatch, 'Actual clock refusal condition')
            elif receipt['site'] == 'intersection':
                require(s is not None and receipt['limitFrame'] is not None, 'Intersection window')
                first = max(b,s); last = min(b+receipt['incomingLength'],receipt['limitFrame'])
                require(last > first and first != s+receipt['captured'], 'Actual intersection refusal condition')
            else:
                raise ValueError('Unknown receipt site')
            require(s is None or b >= s or receipt['captured'] == 0, 'No samples captured before start')
            require(index+1 < len(events) and events[index+1]['kind'] == 'incoming'
                    and events[index+1]['data'] == {'type':'error','reason':data['reason']}, 'Original error follows research receipt')
            summary['refusals'].append({'row':row['row'],'sequence':index,'site':receipt['site'],
                'previousEnd':p,'incomingStart':b,'incomingLength':receipt['incomingLength'],
                'startFrame':s,'captured':receipt['captured'],'overlapFrames':max(0,p-b) if p is not None else None})
    for control in controls:
        result = control['result']; messages = result['messages']
        require(control['failure'] is None and result['closed'] is True and result['samples'] is None, 'Control cleanup/no PCM')
        receipts = [m for m in messages if m['type'] == 'terminal-clock-research300']
        require(len(receipts) == 1, 'One terminal receipt')
        receipt = receipts[0]; at = messages.index(receipt)
        require(receipt['reason'] == 'invalid-command' and receipt['ready'] is True and receipt['armed'] is True
                and receipt['sampleRate'] == control['rate'] and receipt['receipt'] is None, 'Native control metadata')
        require(messages[at+1:] == [{'type':'error','reason':'invalid-command'}], 'Original control error preserved')
    summary['nativeRefusals'] = len(summary['refusals'])
    return summary


def replay(root):
    manifest = json.loads((root/'manifest.json').read_text())
    for name, expected in manifest['files'].items():
        require(Path(name).is_relative_to('.') and '..' not in Path(name).parts and not Path(name).is_absolute(), 'Bounded evidence path')
        require(hashlib.sha256((root/name).read_bytes()).hexdigest() == expected, 'Evidence hash: '+name)
    rows = [json.loads((root/'receipts'/f'{i:02}.json').read_text()) for i in range(10)]
    controls = [json.loads((root/'receipts'/f'control-{r}.json').read_text()) for r in (44100,48000)]
    return analyze(rows,controls)


if __name__ == '__main__':
    print(json.dumps(replay(Path(__file__).parent),indent=2))
