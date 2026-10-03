interface Article { id: string; title: string; category: string; minutes: number; intro: string; paragraphs: string[] }

const articles: Article[] = [
  { id: 'quiet', title: 'The quiet web', category: 'Technology', minutes: 4,
    intro: 'What if the next generation of interfaces asked a little less of us?',
    paragraphs: [
      'The best tools often make room for your attention. They hold the details while you hold the thought. A quiet interface gives you a place to begin, a clear next step, and permission to stop.',
      'On the early web, a page was a destination. Today it can feel like a corridor lined with people calling your name. Every notification asks for a decision, even when the decision is to ignore it.',
      'Designing for attention means making fewer assumptions. A highlight can be a suggestion. A pause can be an invitation. A click should remain a choice.',
      'Consider the difference between a door that opens as you pass and one that shows you where to push. Both can be useful, but only one preserves the moment of intention. For tools that interpret our bodies, that moment matters.',
      'A gaze signal is imperfect. It can be curious, distracted, or merely passing through. Good assistance makes uncertainty visible and waits for a person to resolve it.',
      'The quiet web is not a particular palette or a slower animation. It is an agreement: your attention belongs to you, and the interface is here to help you spend it well.',
    ] },
  { id: 'space', title: 'A place to think', category: 'Design', minutes: 3,
    intro: 'Small spaces, generous margins, and the art of leaving something out.',
    paragraphs: [
      'Empty space is often the most useful part of a composition. It tells us what belongs together and what can wait. It gives the eye somewhere to rest before the next idea.',
      'In a room, a clear table makes a project feel possible. In an interface, a clear hierarchy does the same. The size of an action can say as much as its label.',
      'When we design a space for thinking, we design its edges first: what enters, what interrupts, and what remains within easy reach. The middle can then be used for the work itself.',
      'A useful experiment is to remove one thing each day. A redundant label. A competing color. An unnecessary decision. Keep what helps a person understand where they are.',
      'Generosity in design is practical. It means bigger targets, readable type, and room for an imperfect input. Precision should be a quality of the tool, not a demand placed on the person.',
    ] },
  { id: 'walk', title: 'Take the long way', category: 'Life', minutes: 5,
    intro: 'A short argument for wandering without optimizing the route.',
    paragraphs: [
      'A familiar walk changes when we stop asking how quickly it can be finished. The street becomes a collection of details instead of a line between two points.',
      'There is a kind of learning that happens only at walking speed. You notice where the light lands, which gardens have changed, and how a neighborhood sounds at different hours.',
      'We give tools the job of reducing friction. Sometimes that gives us time back. Sometimes it removes the useful detours. The difference depends on what we wanted from the journey.',
      'Try taking one turn you usually pass. Leave the headphones in your pocket for a few minutes. The point is not to discover something extraordinary, but to become available to ordinary things.',
      'Returning can be part of the experiment too. The same street looks different in the other direction. It is a small reminder that perspective changes what was there all along.',
    ] },
  { id: 'human', title: 'Human-sized tools', category: 'Design', minutes: 4,
    intro: 'Why helpful technology should make its reasoning easy to see.',
    paragraphs: [
      'A tool becomes easier to trust when it tells you what it thinks is happening. A visible suggestion gives you something specific to agree with, correct, or ignore.',
      'Automation is most useful when its boundaries are clear. What information did it use? Which choices did it consider? What will happen if you say yes?',
      'The answer need not be a technical explanation. This button is closest to where you are looking is enough to connect an input to a recommendation.',
      'Corrections are part of an interaction, not evidence that a person failed to use it. A humane tool expects revision and makes it cheap.',
      'The size of a tool is also the size of its promises. An honest prototype can demonstrate a useful idea while leaving its uncertainty in view. That is a good place to start.',
    ] },
];

export function createWorkspace(root: HTMLElement, onAction: (label: string) => void) {
  let category = 'All';
  let selected: Article | null = null;
  const saved = new Set<string>();

  function render() {
    root.innerHTML = `
      <div class="browser-bar"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="address">▣ &nbsp; fieldnotes.local / ${selected ? selected.id : 'library'}</span><span class="browser-tag">WORKSPACE</span></div>
      <div class="publication-header"><span class="publication-name">fieldnotes<span>→</span></span><span class="publication-caption">A small collection of good ideas.</span></div>
      ${selected ? `
        <div class="article-toolbar">
          <button data-gaze="back" aria-label="Back to library">← Library</button>
          <div class="reading-actions">
            <button data-gaze="save" aria-label="${saved.has(selected.id) ? 'Unsave' : 'Save'} article">${saved.has(selected.id) ? '✓ Saved' : '＋ Save'}</button>
            <button data-gaze="up" aria-label="Scroll up">↑</button>
            <button data-gaze="down" aria-label="Scroll down">↓</button>
          </div>
        </div>
        <article id="reading-pane" tabindex="0" aria-label="Article reading pane">
          <p class="eyebrow">${selected.category} · ${selected.minutes} MIN READ</p>
          <h2>${selected.title}</h2><p class="article-intro">${selected.intro}</p>
          ${selected.paragraphs.map(p => `<p>${p}</p>`).join('')}
          <p class="article-end">Thanks for reading. Take a moment.</p>
        </article>` : `
        <div class="library-intro"><p class="eyebrow">THE READING ROOM</p><h2>Something worth your attention.</h2></div>
        <nav class="category-tabs" aria-label="Article categories">${['All', 'Design', 'Technology', 'Life'].map(c => `
          <button data-gaze="category-${c}" aria-label="Show ${c.toLowerCase()} articles" aria-pressed="${category === c}">${c}</button>`).join('')}</nav>
        <div class="article-grid">${articles.filter(a => category === 'All' || a.category === category).map(a => `
          <button class="article-card ${a.id}" data-gaze="article-${a.id}" aria-label="Open ${a.title}">
            <span class="card-art" aria-hidden="true"><span></span><span></span><span></span></span>
            <span class="card-meta">${a.category} <span>${a.minutes} min</span></span>
            <span class="card-title">${a.title}</span><span class="card-intro">${a.intro}</span><span class="card-arrow" aria-hidden="true">→</span>
          </button>`).join('')}</div>`}
      <div class="workspace-footer"><span>Explore, select, scroll.</span><span>All actions stay in this workspace →</span></div>`;
  }

  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-gaze]');
    if (!button || !root.contains(button)) return;
    const id = button.dataset.gaze!;
    const label = button.getAttribute('aria-label') ?? button.textContent ?? id;
    if (id.startsWith('article-')) selected = articles.find(a => a.id === id.slice(8)) ?? null;
    else if (id.startsWith('category-')) category = id.slice(9);
    else if (id === 'back') selected = null;
    else if (id === 'save' && selected) {
      if (saved.has(selected.id)) saved.delete(selected.id); else saved.add(selected.id);
      button.setAttribute('aria-label', `${saved.has(selected.id) ? 'Unsave' : 'Save'} article`);
      button.textContent = saved.has(selected.id) ? '✓ Saved' : '＋ Save';
      onAction(label);
      return;
    } else if (id === 'up' || id === 'down') {
      root.querySelector('#reading-pane')?.scrollBy({ top: id === 'down' ? 260 : -260, behavior: 'smooth' });
      onAction(label);
      return;
    }
    render();
    onAction(label);
  });
  render();
}
