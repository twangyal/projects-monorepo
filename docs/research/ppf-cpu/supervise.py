"""Linux-only wall bound for a probe and its detached native descendants."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import time

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--seconds',required=True,type=float)
parser.add_argument('--out',required=True,type=Path)
parser.add_argument('command',nargs=argparse.REMAINDER)
args=parser.parse_args();command=args.command[1:] if args.command[:1]==['--'] else args.command
if not command or args.seconds<=0:raise SystemExit('Supply a command and positive wall limit.')
# Linux subreapers adopt grandchildren even when their parent exits or they call setsid().
# Every process cleaned up below belongs to this dedicated supervisor, never another CI job.
if ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)!=0:raise OSError(ctypes.get_errno(),'Cannot establish native child subreaper')
args.out.mkdir(parents=True,exist_ok=True)

def process_ids(path):
    fields=dict(line.split(':',1) for line in path.read_text().splitlines() if ':' in line)
    return int(fields['Pid']),int(fields['PPid']),list(map(int,fields['NSpid'].split()))

host_pid,_,namespace_ids=process_ids(Path('/proc/self/status'))
namespace_depth=len(namespace_ids)

def descendants():
    # /proc may expose host PIDs inside a nested PID namespace. Build ancestry in
    # that namespace, then translate to our namespace before signaling children.
    rows={}
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():continue
        try:
            host,parent,ids=process_ids(path/'status')
            if len(ids)>=namespace_depth:rows[host]=(parent,ids[namespace_depth-1])
        except (FileNotFoundError,PermissionError):continue
    found={host_pid};changed=True
    while changed:
        added={pid for pid,(parent,_) in rows.items() if parent in found and pid not in found}
        changed=bool(added);found.update(added)
    return {rows[pid][1] for pid in found if pid!=host_pid and pid in rows}

def reap():
    while True:
        try:
            pid,_=os.waitpid(-1,os.WNOHANG)
            if not pid:return
        except ChildProcessError:return

def stop_children():
    deadline=time.monotonic()+5
    while True:
        reap();children=descendants()
        if not children:return []
        if time.monotonic()>=deadline:return sorted(children)
        action=signal.SIGTERM if time.monotonic()<deadline-3 else signal.SIGKILL
        for pid in sorted(children,reverse=True):
            try:os.kill(pid,action)
            except ProcessLookupError:pass
        time.sleep(.02)

def interrupted(_signum,_frame):raise InterruptedError('Supervisor interrupted')
signal.signal(signal.SIGTERM,interrupted)
started=time.monotonic();status='started';code=1
try:
    process=subprocess.Popen(command,start_new_session=True)
    try:
        code=process.wait(timeout=args.seconds);status='completed' if code==0 else 'failed'
    except subprocess.TimeoutExpired:
        status='timed_out';code=124
except (KeyboardInterrupt,InterruptedError):status='interrupted';code=130
finally:
    remaining=stop_children()
    if remaining:status='failed_cleanup';code=1
    receipt={'status':status,'exit_code':code,'wall_limit_seconds':args.seconds,
             'wall_seconds_including_cleanup':time.monotonic()-started,'remaining_children':len(remaining)}
    (args.out/'supervisor.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt),flush=True)
raise SystemExit(code)
