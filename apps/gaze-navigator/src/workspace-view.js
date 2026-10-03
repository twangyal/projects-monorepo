import { createWorkspace } from './workspace.js';

export function setupWorkspace(document, onLayoutChange) {
  const workspace = createWorkspace();
  const node = id => document.querySelector(`#${id}`);
  const list = node('messageList');
  const detail = node('messageDetail');
  const composer = node('composer');
  const result = node('result');
  let visible = workspace.search();
  let selected = null;

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
    composer.classList.remove('hidden');
    node('draftSubject').focus();
    result.textContent = 'Write a practice draft, then save it locally.';
    onLayoutChange();
  });
  node('cancelDraft').addEventListener('click', () => {
    composer.classList.add('hidden');
    onLayoutChange();
  });
  node('saveDraft').addEventListener('click', () => {
    try {
      workspace.saveDraft(node('draftSubject').value, node('draftBody').value);
      const drafts = node('draftList');
      drafts.replaceChildren();
      for (const draft of workspace.drafts()) {
        const item = document.createElement('p');
        item.textContent = `${draft.subject}: ${draft.body}`;
        drafts.append(item);
      }
      node('draftSubject').value = '';
      node('draftBody').value = '';
      composer.classList.add('hidden');
      result.textContent = 'Draft saved for this session. Nothing was sent.';
      onLayoutChange();
    } catch (error) {
      result.textContent = error.message;
    }
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
  renderMessages();
}
