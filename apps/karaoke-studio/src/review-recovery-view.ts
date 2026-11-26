import { reviewCheckpointBinding } from './review-checkpoint.ts';
import { createReviewRecoveryStore, makeRecoveryRecord, readRecoveryDraft, RecoveryConflictError, RecoveryDeletedError, type RecoveryRecord, type ReviewRecoveryStore } from './review-recovery-store.ts';
import type { ReviewedCue } from './automatic-review.ts';

export interface RecoveryContext {
  owner: object; projectId: string; duration: number; source: RecoveryRecord['source']; identity: string | null;
  original: unknown; revision: string; draft: ReviewedCue[]; checked: number[]; allowed: boolean;
}
interface Session {
  owner: object; projectId: string; initial: string; observed: string; binding: string | null; record: RecoveryRecord | null;
  blocked: boolean; loading: boolean; error: string; pending: RecoveryContext | null; timer: ReturnType<typeof setTimeout> | null;
  writes: Promise<void>; operation: number;
}
const PREFERENCE = 'karaoke-review-recovery-enabled';
const signature = (context: RecoveryContext) => JSON.stringify([context.draft,context.checked]);
const reason = (error: unknown) => error instanceof Error ? error.message : 'Browser recovery could not finish. Download a manual checkpoint before leaving.';

/** Private, opt-in recovery. Its async operations never own the applied lyric editor. */
export function mountReviewRecovery(host: HTMLElement, options: {
  capture: () => RecoveryContext | null;
  restore: (context: RecoveryContext, draft: ReturnType<typeof readRecoveryDraft>) => boolean;
  download: (text: string) => void;
  store?: ReviewRecoveryStore;
}) {
  host.innerHTML = `<label><input type="checkbox" data-recovery-keep> Keep a recovery copy in this browser</label>
    <p class="fine">Opt in to save private review words, raw times, exclusions and checked progress here. Wait for “Recovery copy saved” before leaving. Nothing is applied or saved as lyrics. Reopen the same recognition reading, then Restore. One latest copy per clip, up to 20 copies of 1 MiB; no audio. Turning this off stops future saves across tabs when the preference is remembered, but keeps existing copies until Delete. A browser copy is separate from a portable checkpoint and saved-clip backup; clearing browser storage removes it.</p>
    <p id="review-recovery-preference" class="fine" role="status"></p>
    <div class="timing-actions"><button class="quiet" data-recovery-restore hidden>Restore recovery copy</button><button class="quiet" data-recovery-download hidden>Download recovery copy</button><button class="quiet" data-recovery-delete hidden>Delete recovery copy</button></div>
    <p id="review-recovery-status" class="fine" role="status" aria-live="polite"></p>`;
  const keep = host.querySelector<HTMLInputElement>('[data-recovery-keep]')!;
  const restore = host.querySelector<HTMLButtonElement>('[data-recovery-restore]')!;
  const download = host.querySelector<HTMLButtonElement>('[data-recovery-download]')!;
  const remove = host.querySelector<HTMLButtonElement>('[data-recovery-delete]')!;
  const status = host.querySelector<HTMLElement>('#review-recovery-status')!;
  const preference = host.querySelector<HTMLElement>('#review-recovery-preference')!;
  const store = options.store ?? createReviewRecoveryStore();
  const writesByClip = new Map<string,Promise<void>>(), deletedClips = new Set<string>();
  let session: Session | null = null, suspended = false, preferenceRemembered = true;
  try { keep.checked = localStorage.getItem(PREFERENCE) === 'on'; } catch { preferenceRemembered = false; preference.textContent = 'The recovery preference could not be read. Recovery starts off; check the choice after reopening.'; }
  function permitted() {
    if (!keep.checked) return false;
    if (!preferenceRemembered) return true;
    try { return localStorage.getItem(PREFERENCE) === 'on'; }
    catch { preferenceRemembered = false; preference.textContent = 'This choice applies only to this session because the browser could not read its preference; check the choice after reopening.'; return true; }
  }
  const current = (value: Session) => { const context = options.capture(); return session === value && context?.owner === value.owner ? context : null; };
  function message(value: Session, text: string) { if (current(value)) status.textContent = text; }
  function controls(value: Session) {
    const context = current(value); if (!context) return;
    const allowed = context.allowed;
    keep.disabled = !allowed;
    restore.hidden = !value.record || !value.blocked;
    restore.disabled = !allowed || value.loading || !value.binding || value.record?.binding !== value.binding;
    download.hidden = remove.hidden = !value.record;
    download.disabled = remove.disabled = !allowed || value.loading;
  }
  function cancelTimer(value: Session) { if (value.timer !== null) clearTimeout(value.timer); value.timer = null; }
  function save(value: Session) {
    cancelTimer(value);
    const context = value.pending; value.pending = null;
    if (!context || !permitted() || value.blocked || !value.binding) return;
    const binding = value.binding;
    value.writes = (writesByClip.get(context.projectId) ?? Promise.resolve()).then(async () => {
      if (!permitted() || value.blocked || deletedClips.has(context.projectId)) return;
      const record = makeRecoveryRecord(context.projectId,context.source,binding,context.draft,context.checked);
      const saved = await store.save(record,value.record?.revision ?? null,permitted);
      value.record = saved; value.error = '';
      const live = current(value);
      if (live) {
        controls(value);
        message(value,signature(live) === signature(context) ? 'Recovery copy saved in this browser. No lyrics were applied or saved.' : 'Saving recovery copy…');
      }
    }).catch(error => {
      value.blocked = error instanceof RecoveryConflictError || error instanceof RecoveryDeletedError; value.error = reason(error);
      cancelTimer(value); value.pending = null;
      message(value,`${value.error} Current review words are kept. ${value.blocked ? 'Download a manual checkpoint if its fields fit the limits.' : 'Correct the draft or turn recovery off and on to retry. Checkpoints need at most 2,048 characters per draft and 64 per time field.'}`);
      controls(value);
      const live = current(value);
      if (live && !value.blocked && signature(live) !== signature(context)) schedule(value,live);
    });
    writesByClip.set(context.projectId,value.writes);
    const completed = value.writes;
    void completed.then(() => { if (writesByClip.get(context.projectId) === completed) writesByClip.delete(context.projectId); });
  }
  function schedule(value: Session, context: RecoveryContext) {
    if (!permitted() || !context.allowed || value.blocked) return;
    value.pending = context;
    if (value.loading || !value.binding) return;
    cancelTimer(value);
    message(value,'Saving recovery copy…');
    value.timer = setTimeout(() => save(value),250);
  }
  function attach(context: RecoveryContext, owned?: { binding: string; record: RecoveryRecord | null }): Session {
    const value: Session = {owner:context.owner,projectId:context.projectId,initial:signature(context),observed:context.revision,binding:owned?.binding ?? null,
      record:owned?.record ?? null,blocked:false,loading:!owned,error:'',pending:null,timer:null,writes:Promise.resolve(),operation:0};
    session = value; controls(value);
    if (owned) return value;
    status.textContent = 'Checking this browser for a recovery copy…';
    const binding = context.identity ? reviewCheckpointBinding(context.projectId,context.duration,context.source,{identity:context.identity,original:context.original})
      : Promise.reject(new Error('Restart the updated local service and reopen this recognition reading before saving browser recovery.'));
    Promise.all([binding,store.load(context.projectId)]).then(([key,record]) => {
      if (!current(value)) return;
      value.binding = key; value.record = record; value.loading = false; value.blocked = !!record;
      controls(value);
      if (record) message(value,record.binding === key ? 'A recovery copy is available. Restore it or delete it before saving new review edits.'
        : 'The recovery copy belongs to another recognition reading. Download or delete it before saving this reading; current drafts are kept.');
      else {
        const live = current(value)!;
        message(value,keep.checked ? 'Recovery is enabled. Review changes will be saved in this browser.' : 'Recovery is off. Download a manual checkpoint to keep unfinished work.');
        if (value.pending || signature(live) !== value.initial) schedule(value,live);
      }
    }).catch(error => { if (!current(value)) return; value.loading = false; value.blocked = true; value.error = reason(error); message(value,`${value.error} Use a manual checkpoint; current drafts are kept.`); controls(value); });
    return value;
  }
  function sync() {
    if (suspended) return;
    const context = options.capture();
    if (!context) {
      if (session) save(session);
      session = null; keep.disabled = true; return;
    }
    if (!session || session.owner !== context.owner) {
      if (session) save(session);
      attach(context); return;
    }
    controls(session);
    if (session.observed !== context.revision) {
      session.observed = context.revision;
      schedule(session,context);
    }
  }
  function preferenceChanged() {
    const value = session, context = value && current(value); if (!value || !context) return;
    if (!keep.checked) { cancelTimer(value); value.pending = null; message(value,'Recovery is off. An existing copy stays until Delete; download a manual checkpoint for new work.'); }
    else if (value.blocked) message(value,value.error || 'Restore or delete the existing recovery copy before saving new review edits.');
    else schedule(value,context);
  }
  keep.addEventListener('change', () => {
    try { localStorage.setItem(PREFERENCE,keep.checked ? 'on' : 'off'); preferenceRemembered = true; preference.textContent = ''; }
    catch { preferenceRemembered = false; preference.textContent = 'This choice applies only to this session because the browser could not remember it; check the choice after reopening.'; }
    preferenceChanged();
  });
  window.addEventListener('storage',event => {
    if (event.key !== PREFERENCE && event.key !== null) return;
    try { if (event.storageArea !== localStorage) return; keep.checked = localStorage.getItem(PREFERENCE) === 'on'; }
    catch { return; }
    preferenceRemembered = true; preference.textContent = ''; preferenceChanged();
  });
  restore.addEventListener('click', async () => {
    const value = session, captured = value && current(value); if (!value || !captured?.allowed || !value.binding) return;
    const operation = ++value.operation;
    const unchanged = () => current(value)?.allowed === true && current(value)?.revision === captured.revision && value.operation === operation;
    try {
      const record = await store.load(captured.projectId);
      if (!unchanged()) { message(value,'Newer review edits were kept. Choose Restore again if needed.'); return; }
      if (!record) throw new Error('The recovery copy was deleted. Reopen this review to save a new copy.');
      const recovered = readRecoveryDraft(record,value.binding,captured.draft.length);
      if (!window.confirm('Replace staged review words, raw times, exclusions and checked markers with this browser recovery copy? Applied and saved lyrics stay unchanged.')) { message(value,'Restoration cancelled. Current review drafts were kept.'); return; }
      if (!unchanged()) return;
      suspended = true;
      let applied: boolean;
      try { applied = options.restore(captured,recovered); } finally { suspended = false; }
      const next = options.capture();
      if (!applied || !next) return;
      const restored = attach(next,{binding:value.binding,record});
      message(restored,'Recovery copy restored. No lyrics were applied or saved.'); controls(restored);
    } catch(error) { message(value,`${reason(error)} Current review drafts are unchanged.`); }
  });
  download.addEventListener('click', async () => {
    const value = session, context = value && current(value); if (!value || !context?.allowed) return;
    try {
      await writesByClip.get(context.projectId);
      const record = await store.load(context.projectId);
      if (!current(value)?.allowed) return;
      if (!record) throw new Error('No recovery copy is stored for this clip.');
      options.download(record.checkpoint); message(value,'Recovery copy downloaded as a portable checkpoint. Nothing was applied.');
    } catch(error) { message(value,reason(error)); }
  });
  remove.addEventListener('click', async () => {
    const value = session, captured = value && current(value); if (!value || !captured?.allowed || !value.record) return;
    const operation = ++value.operation;
    const wasBlocked = value.blocked;
    const pendingBefore = value.pending;
    const resume = (text: string) => {
      value.blocked = wasBlocked; controls(value); message(value,text);
      const live = current(value);
      if (live && !wasBlocked && (pendingBefore || live.revision !== captured.revision)) schedule(value,live);
    };
    cancelTimer(value); value.pending = null; value.blocked = true;
    try {
      await writesByClip.get(captured.projectId);
      if (!current(value)?.allowed || current(value)?.revision !== captured.revision || value.operation !== operation) { resume('Newer review edits were kept. Choose Delete again if needed.'); return; }
      if (!window.confirm('Delete this clip’s recovery copy from this browser? Current review drafts and saved lyrics stay unchanged.')) { resume('Recovery copy kept.'); return; }
      await store.remove(captured.projectId,value.record.revision);
      if (!current(value)) return;
      value.record = null; value.blocked = false; value.error = ''; value.observed = captured.revision;
      controls(value); message(value,'Recovery copy deleted. New edits can create a copy while recovery is enabled.');
      if (current(value)!.revision !== captured.revision) schedule(value,current(value)!);
    } catch(error) { value.error = reason(error); message(value,value.error); controls(value); }
  });
  return {
    sync,
    async forget(projectId: string) {
      deletedClips.add(projectId);
      const value = session?.projectId === projectId ? session : null;
      if (value) { cancelTimer(value); value.pending = null; value.blocked = true; }
      await writesByClip.get(projectId);
      await store.forget(projectId);
    },
  };
}
