const MESSAGES = [
  { id: 'welcome', subject: 'Welcome to your practice inbox', body: 'Use the large controls to browse messages. Every action stays on this page.' },
  { id: 'calibration', subject: 'Tips for calibration', body: 'Keep your head still and look at the dot while clicking. Lighting and camera placement affect accuracy.' },
  { id: 'break', subject: 'Take a comfortable break', body: 'Pause whenever you need. You can always use the mouse or keyboard for these controls.' },
  { id: 'privacy', subject: 'Your practice workspace is local', body: 'Drafts stay in memory for this session. Nothing is sent, and refreshing clears them.' },
];

export function createWorkspace() {
  const saved = [];
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
      if (!subject.trim() && !body.trim()) throw new Error('Write a subject or message before saving.');
      const draft = { id: `draft-${saved.length + 1}`, subject: subject.trim() || 'Untitled draft', body: body.trim() };
      saved.push(draft);
      return { ...draft };
    },
    drafts: () => saved.map(draft => ({ ...draft })),
  };
}
