import { createWorkspace } from './workspace.js';
import {encodeDraftBackup,parseDraftBackup,MAX_BACKUP_BYTES} from './draft-backup.js';

export function setupWorkspace(document, onLayoutChange, onComposerChange = () => {}) {
  const workspace = createWorkspace();
  const node = id => document.querySelector(`#${id}`);
  const list = node('messageList');
  const detail = node('messageDetail');
  const composer = node('composer');
  const result = node('result');
  let visible = workspace.search();
  let selected = null;
  let editing = null;
  let accepted = { subject: '', body: '' };
  let pending = null;
  let importEpoch=0;
  const fields = () => ({ subject: node('draftSubject').value, body: node('draftBody').value });
  const dirty = () => { const current=fields();return current.subject!==accepted.subject||current.body!==accepted.body; };

  function showComposer() {
    composer.classList.remove('hidden');
    composer.scrollIntoView?.({block:'center'});
    node('draftSubject').focus({preventScroll:true});
    onLayoutChange();
  }
  function openDraft(id) {
    const draft=id===null?{subject:'',body:''}:workspace.draft(id);
    if(!draft)return;
    onComposerChange();editing=id;accepted={subject:draft.subject,body:draft.body};
    node('draftSubject').value=draft.subject;node('draftBody').value=draft.body;
    node('saveDraft').textContent=id===null?'Save draft':'Update draft';
    result.textContent=id===null?'Write a new practice draft.':'Editing a saved session draft. Update replaces this draft only.';
    showComposer();
  }
  function reviewOpen(id) {
    if(pending)return;
    if(id!==null&&id===editing){showComposer();return;}
    if(!dirty()){openDraft(id);return;}
    onComposerChange();pending={id};
    node('draftReview').classList.remove('hidden');
    node('draftReviewText').textContent=id===null?'Start a blank draft and replace the current unsaved composer text?':'Open the saved draft and replace the current unsaved composer text?';
    node('saveDraft').disabled=true;
    node('draftReview').scrollIntoView?.({block:'center'});
    onLayoutChange();
  }
  function closeReview() {
    pending=null;node('draftReview').classList.add('hidden');node('saveDraft').disabled=false;
    onLayoutChange();
  }
  node('keepComposer').addEventListener('click',()=>{closeReview();result.textContent='Current composer text kept.';});
  node('replaceComposer').addEventListener('click',()=>{if(!pending)return;const id=pending.id;closeReview();openDraft(id);});
  node('newDraft').addEventListener('click',()=>reviewOpen(null));

  function renderDrafts() {
    const drafts=node('draftList');drafts.replaceChildren();
    node('downloadDrafts').disabled=workspace.drafts().length===0;
    for(const draft of workspace.drafts()){
      const item=document.createElement('article'),button=document.createElement('button');
      item.dataset.draftId=draft.id;
      item.textContent=`${draft.subject}: ${draft.body.slice(0,240)}${draft.body.length>240?'…':''}`;
      button.textContent=`Open draft: ${draft.subject}`;button.setAttribute('data-gaze-target','');
      button.addEventListener('click',()=>reviewOpen(draft.id));item.append(button);drafts.append(item);
    }
  }

  function select(id) {
    const message = workspace.select(id);
    if (!message) return;
    selected = id;
    detail.textContent = `${message.subject}\n\n${message.body}`;
    result.textContent = `${message.subject} selected.`;
  }

  function renderMessages() {
    list.replaceChildren();
    for (const message of visible) {
      const button = document.createElement('button');
      button.className = 'message-target';
      button.textContent = message.subject;
      button.setAttribute('data-gaze-target', '');
      button.addEventListener('click', () => select(message.id));
      list.append(button);
    }
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No matching messages. Try another search.';
      list.append(empty);
    }
    onLayoutChange();
  }

  node('composeButton').addEventListener('click', () => {
    result.textContent = 'Write a practice draft, then save it locally.';
    showComposer();
  });
  node('cancelDraft').addEventListener('click', () => {
    composer.classList.add('hidden');
    onLayoutChange();
  });
  node('saveDraft').addEventListener('click', () => {
    if(pending)return;
    try {
      const current=fields();
      if(editing)workspace.updateDraft(editing,current.subject,current.body);
      else workspace.saveDraft(current.subject,current.body);
      renderDrafts();editing=null;accepted={subject:'',body:''};
      node('draftSubject').value = '';
      node('draftBody').value = '';
      node('saveDraft').textContent='Save draft';
      composer.classList.add('hidden');
      result.textContent = 'Draft saved for this session. Nothing was sent.';
      onLayoutChange();
    } catch (error) {
      result.textContent = error.message;
    }
  });
  node('downloadDrafts').addEventListener('click',()=>{
    try{
      const rows=workspace.drafts().map(({subject,body})=>({subject,body}));
      const win=document.defaultView;
      const url=win.URL.createObjectURL(new win.Blob([encodeDraftBackup(rows)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='gaze-session-drafts.json';
      try{link.click();}finally{win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);}
      result.textContent='Backup download requested for saved drafts only. Current unsaved composer text was excluded.';
    }catch(error){result.textContent=error.message;}
  });
  node('importDrafts').addEventListener('click',()=>{node('draftBackupChooser').hidden=false;node('draftBackupFile').focus({preventScroll:true});node('draftBackupChooser').scrollIntoView?.({block:'center'});result.textContent='Use the visible file chooser with a mouse or keyboard. Gaze cannot open the system chooser.';onLayoutChange();});
  node('draftBackupFile').addEventListener('change',async()=>{
    const epoch=++importEpoch,file=node('draftBackupFile').files?.[0];node('draftBackupFile').value='';
    if(!file)return;
    result.textContent='Reading draft backup. Current drafts and composer stay available.';
    try{
      if(file.size>MAX_BACKUP_BYTES)throw Error('Draft backups are limited to 2 MiB.');
      const text=await file.text();if(epoch!==importEpoch)return;
      const added=workspace.appendDrafts(parseDraftBackup(text));renderDrafts();
      result.textContent=`Imported ${added.length} drafts into this session. Current composer text was kept. Nothing was sent.`;
      onLayoutChange();
    }catch(error){if(epoch===importEpoch)result.textContent=error.message;}
  });
  node('searchButton').addEventListener('click', () => {
    visible = workspace.search(node('searchInput').value);
    selected = null;
    detail.textContent = 'Select a message to read it.';
    renderMessages();
    result.textContent = `${visible.length} messages found.`;
  });
  node('searchInput').addEventListener('input', onLayoutChange);
  node('scrollButton').addEventListener('click', () => {
    list.scrollBy({ top: 220, behavior: 'auto' });
    result.textContent = 'Message list scrolled down.';
    onLayoutChange();
  });
  node('selectButton').addEventListener('click', () => {
    if (!visible.length) return;
    const index = visible.findIndex(message => message.id === selected);
    select(visible[(index + 1) % visible.length].id);
  });
  renderDrafts();
  renderMessages();
}
