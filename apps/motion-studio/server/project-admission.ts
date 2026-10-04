import { Worker } from 'node:worker_threads';
import { ADMISSION_TIMEOUT_MS, MAX_PROJECT_BYTES, MotionError, type AdmittedProject } from './types.ts';

let occupied = false;

export async function admitPortableProject(bytes: Uint8Array, {signal}: { signal?: AbortSignal } = {}): Promise<AdmittedProject> {
  if (signal?.aborted) throw new MotionError('cancelled', 'Publication admission was cancelled.');
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_PROJECT_BYTES) throw new MotionError('invalid', 'Choose a nonempty project within the portable byte limit.');
  if (occupied) throw new MotionError('busy', 'Another snapshot is being admitted; try again after it finishes.');
  occupied = true;
  const captured = new Uint8Array(bytes), deadline = performance.now()+ADMISSION_TIMEOUT_MS;
  const owner: {worker:Worker|null} = {worker:null};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (()=>void) | undefined;
  try {
    const result = await new Promise<AdmittedProject>((resolve,reject) => {
      let settled = false;
      const finish = (error?: MotionError, value?: AdmittedProject) => {
        if (settled) return; settled = true;
        if (error) reject(error); else resolve(value!);
      };
      abort = () => finish(new MotionError('cancelled','Publication admission was cancelled.'));
      const worker = new Worker(new URL('./project.worker.ts',import.meta.url),{
        workerData:captured,transferList:[captured.buffer],resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16},
      });
      owner.worker = worker;
      timer = setTimeout(()=>finish(new MotionError('timeout','Project admission timed out.')),ADMISSION_TIMEOUT_MS);
      signal?.addEventListener('abort',abort,{once:true});
      if (signal?.aborted) abort();
      worker.on('message',(message:{ok?:boolean} & Partial<AdmittedProject>) => {
        if (signal?.aborted) return abort!();
        if (performance.now() >= deadline) return finish(new MotionError('timeout','Project admission timed out.'));
        if (message.ok !== true || !message.project || !(message.json instanceof Uint8Array) || typeof message.sha256 !== 'string') return finish(new MotionError('invalid','The complete project or an embedded PNG was invalid.'));
        finish(undefined,{project:message.project,json:message.json,sha256:message.sha256});
      });
      worker.on('error',()=>finish(new MotionError('invalid','The complete project could not be admitted.')));
      worker.on('exit',()=>finish(new MotionError('invalid','The project admission worker did not finish.')));
    });
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort',abort);
    if (owner.worker) await owner.worker.terminate();
    occupied = false;
  }
}
