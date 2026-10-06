const MESSAGES = [
  { id: 'welcome', subject: 'Welcome to your practice inbox', body: 'Use the large controls to browse messages. Every action stays on this page.' },
  { id: 'calibration', subject: 'Tips for calibration', body: 'Keep your head still and look at the dot while clicking. Lighting and camera placement affect accuracy.' },
  { id: 'break', subject: 'Take a comfortable break', body: 'Pause whenever you need. You can always use the mouse or keyboard for these controls.' },
  { id: 'privacy', subject: 'Your practice workspace is local', body: 'Drafts stay in memory for this session. Nothing is sent, and refreshing clears them.' },
];

export function createWorkspace() {
  const saved = [];
  const content = (subject,body) => {
    if(typeof subject!=='string'||typeof body!=='string')throw new Error('Write a text subject and message.');
    if(subject.length>200||body.length>10000)throw new Error('Draft limits are 200 subject characters and 10000 message characters.');
    if (!subject.trim() && !body.trim()) throw new Error('Write a subject or message before saving.');
    return {subject:subject.trim()||'Untitled draft',body:body.trim()};
  };
  return {
    search(query = '') {
      const term = query.trim().toLowerCase();
      return MESSAGES.filter(message => `${message.subject} ${message.body}`.toLowerCase().includes(term))
        .map(message => ({ ...message }));
    },
    select(id) {
      const message = MESSAGES.find(message => message.id === id);
      return message ? { ...message } : null;
    },
    saveDraft(subject, body) {
      const fields=content(subject,body);
      if(saved.length>=20)throw new Error('Keep at most 20 session drafts. Reopen a draft to update it.');
      const draft = { id: `draft-${saved.length + 1}`, ...fields };
      saved.push(draft);
      return { ...draft };
    },
    draft(id) {const draft=saved.find(item=>item.id===id);return draft?{...draft}:null;},
    updateDraft(id,subject,body) {
      const index=saved.findIndex(item=>item.id===id);
      if(index<0)throw new Error('Saved draft was not found.');
      const draft={id,...content(subject,body)};saved[index]=draft;return {...draft};
    },
    drafts: () => saved.map(draft => ({ ...draft })),
  };
}
