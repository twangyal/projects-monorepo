// Ordinary page behavior for the practice site. It knows nothing about the navigator.
const notice = document.querySelector('.notice');
const say = message => { if (notice) notice.textContent = message; };

for (const form of document.querySelectorAll('form[data-practice]')) {
  form.addEventListener('submit', event => {
    event.preventDefault();
    say(form.dataset.practice);
  });
}
for (const button of document.querySelectorAll('button[data-practice]')) {
  button.addEventListener('click', () => say(button.dataset.practice));
}
const cart = document.querySelector('#cartCount');
for (const button of document.querySelectorAll('.add-to-cart')) {
  button.addEventListener('click', () => {
    cart.textContent = String(Number(cart.textContent) + 1);
    say(`${button.dataset.title} added to your cart.`);
  });
}
// Search suggestions, as many sites show them: a list under the search box that closes when the box loses focus.
const BOOKS = ['The Quiet River', 'River Songs', 'Mountain Letters', 'Gardens of Stone', 'Night Train North'];
for (const box of document.querySelectorAll('input[name=q]')) {
  const list = document.createElement('ul');
  list.className = 'suggestions'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Suggestions'); list.hidden = true;
  box.after(list);
  box.addEventListener('input', () => {
    const typed = box.value.trim().toLowerCase();
    list.replaceChildren(...(typed ? BOOKS.filter(title => title.toLowerCase().includes(typed)) : []).map(title => {
      // As on Wikipedia, each option wraps a link with the same name.
      const option = document.createElement('li'), link = document.createElement('a');
      option.setAttribute('role', 'option'); link.href = 'book.html'; link.textContent = title; option.append(link);
      // A mouse press does not take focus, so the list stays open long enough to be clicked.
      option.addEventListener('mousedown', event => event.preventDefault());
      // A click on the link navigates by itself; the option handles clicks elsewhere on it.
      option.addEventListener('click', event => { if (!event.target.closest('a')) location.href = 'book.html'; });
      return option;
    }));
    list.hidden = !list.children.length;
  });
  box.addEventListener('blur', () => { list.hidden = true; });
}
const results = document.querySelector('#results');
if (results) {
  const query = new URLSearchParams(location.search).get('q') ?? '';
  const found = BOOKS.filter(title => title.toLowerCase().includes(query.toLowerCase().trim()));
  document.querySelector('#query').textContent = query || '(nothing)';
  for (const title of query.trim() ? found : []) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = 'book.html';
    link.textContent = title;
    item.append(link);
    results.append(item);
  }
  if (!results.children.length) results.textContent = 'No books matched.';
}

// A web component whose controls live in an open shadow root, as many design systems do.
if (!customElements.get('nb-feedback')) {
  customElements.define('nb-feedback', class extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>button, input { font: inherit; padding: 6px 10px; margin: 4px; }</style>
        <button>Helpful</button><button>Not helpful</button>
        <label>Comment <input id="comment" /></label>`;
      for (const button of root.querySelectorAll('button')) {
        button.addEventListener('click', () => say(`Thanks for your feedback: ${button.textContent}.`));
      }
    }
  });
}

// Topic cards are clickable only through script and a pointer cursor, with no role or tabindex.
for (const topic of document.querySelectorAll('.topic')) {
  topic.addEventListener('click', () => say(topic.dataset.answer));
}

// Search filters: the toggle shows the panel without submitting its form.
const filterToggle = document.getElementById('filter-toggle');
filterToggle?.addEventListener('click', event => {
  event.preventDefault();
  const open = filterToggle.getAttribute('aria-expanded') !== 'true';
  filterToggle.setAttribute('aria-expanded', String(open));
  document.getElementById('filter-panel').hidden = !open;
});
