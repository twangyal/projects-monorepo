import { test, expect } from '@playwright/test';

// Lists that take several choices, built as three common widgets are: MUI's Autocomplete with multiple values (chips
// with a delete icon, or removed with Backspace; a listbox marked aria-multiselectable that closes on each choice),
// react-select's multi select (chips with a "Remove Red" button; the listbox hides the choices made and does not say it
// takes several), and the WAI-ARIA multi-select listbox (options shown on the page, each click toggling one).
const FILMS = ['Inception', 'The Godfather', 'The Godfather: Part II', 'Pulp Fiction', 'The Dark Knight', 'Fight Club'];
const COLOURS = ['Red', 'Green', 'Blue', 'Yellow'];

async function setup(page, { icons = true } = {}) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async ({ films, colours, icons }) => {
    document.body.innerHTML = `
      <div id="fav-root" style="width: 420px; margin: 20px">
        <label id="fav-label" for="fav">Favorites</label>
        <div id="fav-box" style="display: flex; flex-wrap: wrap; gap: 4px; border: 1px solid #888; padding: 4px">
          <input id="fav" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off" style="flex: 1; min-width: 80px">
        </div>
      </div>
      <label for="col" style="margin: 20px">Colours</label>
      <div class="rs-container" style="width: 420px; margin: 0 20px">
        <div class="rs-control" style="display: flex; border: 1px solid #888">
          <div class="rs-value-container" style="display: flex; flex-wrap: wrap; gap: 4px; flex: 1">
            <div class="rs-input-container"><input id="col" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off"></div>
          </div>
          <div class="rs-indicators"><div class="rs-dropdown-indicator" aria-hidden="true">▾</div></div>
        </div>
      </div>
      <span id="up-label" style="margin: 20px">Upgrades</span>
      <ul id="up" role="listbox" aria-labelledby="up-label" aria-multiselectable="true" tabindex="0" style="width: 300px; margin: 0 20px">
        ${['Leather seats', 'Front seat warmers', 'Rear bucket seats'].map(name => `<li role="option" aria-selected="false">${name}</li>`).join('')}
      </ul>`;
    window.events = [];

    // MUI: chips before the text box; the choices pop up below the page's content and close on each choice.
    const fav = document.querySelector('#fav'), favBox = document.querySelector('#fav-box');
    window.favorites = ['Inception'];
    const favChips = () => {
      favBox.querySelectorAll('.chip').forEach(chip => chip.remove());
      for (const name of window.favorites) {
        const chip = document.createElement('div');
        chip.className = 'chip'; chip.setAttribute('role', 'button'); chip.tabIndex = -1;
        chip.setAttribute('aria-description', 'Press Backspace or Delete to remove');
        chip.innerHTML = `<span class="chip-label">${name}</span>${icons ? '<svg class="chip-deleteIcon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>' : ''}`;
        const remove = () => { window.favorites = window.favorites.filter(other => other !== name); window.events.push(['fav', 'remove', name]); favChips(); };
        chip.querySelector('svg')?.addEventListener('click', remove);
        chip.addEventListener('keyup', event => { if (['Backspace', 'Delete'].includes(event.key)) remove(); });
        favBox.insertBefore(chip, fav);
      }
    };
    const favClose = () => { document.querySelector('#fav-listbox')?.remove(); fav.setAttribute('aria-expanded', 'false'); fav.removeAttribute('aria-controls'); };
    const favOpen = () => {
      favClose();
      const list = document.createElement('ul');
      list.id = 'fav-listbox'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-multiselectable', 'true');
      list.innerHTML = films.filter(film => film.toLowerCase().includes(fav.value.toLowerCase()))
        .map(film => `<li role="option" aria-selected="${window.favorites.includes(film)}">${film}</li>`).join('');
      list.addEventListener('click', event => {
        const name = event.target.closest('[role=option]')?.textContent;
        if (!name) return;
        // Choosing a choice made already takes it off, as MUI does.
        window.favorites = window.favorites.includes(name) ? window.favorites.filter(other => other !== name) : [...window.favorites, name];
        window.events.push(['fav', 'press', name]);
        fav.value = ''; favClose(); favChips();
      });
      document.body.append(list);
      fav.setAttribute('aria-expanded', 'true'); fav.setAttribute('aria-controls', 'fav-listbox');
    };
    fav.addEventListener('keydown', event => { if (event.key === 'ArrowDown') favOpen(); });
    fav.addEventListener('input', favOpen);
    favChips();

    // react-select: each chip has its own remove button; the open list leaves out the choices made.
    const col = document.querySelector('#col'), values = document.querySelector('.rs-value-container');
    window.colours = ['Red'];
    const colChips = () => {
      values.querySelectorAll('.rs-multi-value').forEach(chip => chip.remove());
      for (const name of window.colours) {
        const chip = document.createElement('div');
        chip.className = 'rs-multi-value';
        chip.innerHTML = `<div class="rs-multi-value__label">${name}</div><div role="button" class="rs-multi-value__remove" aria-label="Remove ${name}"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg></div>`;
        chip.querySelector('[role=button]').addEventListener('click', () => { window.colours = window.colours.filter(other => other !== name); window.events.push(['col', 'remove', name]); colChips(); });
        values.insertBefore(chip, values.querySelector('.rs-input-container'));
      }
    };
    const colClose = () => { document.querySelector('#col-menu')?.remove(); col.setAttribute('aria-expanded', 'false'); col.removeAttribute('aria-controls'); };
    const colOpen = () => {
      colClose();
      const menu = document.createElement('div');
      menu.id = 'col-menu'; menu.setAttribute('role', 'listbox');
      menu.innerHTML = colours.filter(colour => !window.colours.includes(colour) && colour.toLowerCase().includes(col.value.toLowerCase()))
        .map(colour => `<div role="option" aria-selected="false">${colour}</div>`).join('');
      menu.addEventListener('click', event => {
        const name = event.target.closest('[role=option]')?.textContent;
        if (!name) return;
        window.colours = [...window.colours, name]; window.events.push(['col', 'press', name]);
        col.value = ''; colClose(); colChips();
      });
      document.querySelector('.rs-container').append(menu);
      col.setAttribute('aria-expanded', 'true'); col.setAttribute('aria-controls', 'col-menu');
    };
    col.addEventListener('keydown', event => { if (event.key === 'ArrowDown') colOpen(); });
    col.addEventListener('input', colOpen);
    colChips();

    // WAI-ARIA multi-select listbox: a click toggles the option clicked.
    document.querySelector('#up').addEventListener('click', event => {
      const option = event.target.closest('[role=option]');
      if (!option) return;
      option.setAttribute('aria-selected', String(option.getAttribute('aria-selected') !== 'true'));
      window.events.push(['up', 'press', option.textContent]);
    });

    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    window.say = async (text, at, radius) => {
      document.querySelector(at).scrollIntoView({ block: 'center' });
      const box = document.querySelector(at).getBoundingClientRect();
      // As the navigator does, its own panel is looked through.
      const exclude = document.querySelector('#gaze-web-navigator');
      const result = window.controller.handle(text, captureContext(document, { x: box.left + 10, y: box.top + box.height / 2, radius, exclude }));
      return await (result.followUp ?? result);
    };
  }, { films: FILMS, colours: COLOURS, icons });
}
const say = (page, text, at, radius = 120) => page.evaluate(([text, at, radius]) => window.say(text, at, radius), [text, at, radius]);
const chosen = (page, list) => page.evaluate(list => window[list], list);
const upgrades = page => page.locator('#up [role=option]').evaluateAll(options => options.filter(option => option.getAttribute('aria-selected') === 'true').map(option => option.textContent));

test('a list showing its choices as chips is added to, never has a choice clicked off by choosing it, and has one taken off by name', async ({ page }) => {
  await setup(page);
  expect(await say(page, 'add the godfather to favorites', '#fav-box')).toMatchObject({ tone: 'success', message: 'The Godfather chosen in Favorites.' });
  expect(await chosen(page, 'favorites')).toEqual(['Inception', 'The Godfather']);
  await expect(page.locator('#fav')).toHaveValue('');
  // Choosing what is chosen already leaves it chosen: pressing it in the list again would take it off.
  expect(await say(page, 'choose inception in favorites', '#fav-box')).toMatchObject({ tone: 'success', message: 'Inception is already chosen in Favorites.' });
  expect(await chosen(page, 'favorites')).toEqual(['Inception', 'The Godfather']);
  expect(await page.evaluate(() => window.events.filter(event => event[1] === 'press').length)).toBe(1);
  // Unnamed, the list looked at is meant: its chips count as the list. With another list showing chips in the circle
  // too, the navigator asks which, as for any two controls of the same kind.
  const asked = await say(page, 'add pulp fiction and fight club', '#fav-box', 300);
  expect(asked).toMatchObject({ tone: 'question' });
  expect(asked.message).toMatch(/Which one\? .*Colours.*Favorites|Which one\? .*Favorites.*Colours/);
  await say(page, 'cancel', '#fav-box');
  expect(await say(page, 'add pulp fiction and fight club', '#fav-box', 40)).toMatchObject({ tone: 'success', message: 'Pulp Fiction and Fight Club chosen in Favorites.' });
  expect(await chosen(page, 'favorites')).toEqual(['Inception', 'The Godfather', 'Pulp Fiction', 'Fight Club']);
  // Taken off by name: the chip's delete icon is pressed.
  expect(await say(page, 'remove the godfather', '#fav-box')).toMatchObject({ tone: 'success', message: 'The Godfather taken off Favorites.' });
  expect(await say(page, 'take pulp fiction and fight club off favorites', '#fav-box')).toMatchObject({ tone: 'success', message: 'Pulp Fiction and Fight Club taken off Favorites.' });
  expect(await chosen(page, 'favorites')).toEqual(['Inception']);
  // A name chosen in no chip is said to be so.
  expect(await say(page, 'remove fight club from favorites', '#fav-box')).toMatchObject({ tone: 'error', message: 'No choice made in Favorites is called “fight club”. Chosen: Inception.' });
});

test('a chip without a delete icon is taken off with Backspace', async ({ page }) => {
  await setup(page, { icons: false });
  expect(await say(page, 'remove inception', '#fav-box')).toMatchObject({ tone: 'success', message: 'Inception taken off Favorites.' });
  expect(await chosen(page, 'favorites')).toEqual([]);
});

test('a list that hides the choices made, and does not say it takes several, is added to by its chips', async ({ page }) => {
  await setup(page);
  expect(await say(page, 'add blue to colours', '.rs-control')).toMatchObject({ tone: 'success', message: 'Blue chosen in Colours.' });
  expect(await say(page, 'choose red in colours', '.rs-control')).toMatchObject({ tone: 'success', message: 'Red is already chosen in Colours.' });
  expect(await say(page, 'choose green and yellow in colours', '.rs-control')).toMatchObject({ tone: 'success', message: 'Green and Yellow chosen in Colours.' });
  expect(await chosen(page, 'colours')).toEqual(['Red', 'Blue', 'Green', 'Yellow']);
  // A listbox shown on the page is not the closed combobox's list: nothing in it is pressed.
  expect(await say(page, 'choose leather seats in colours', '.rs-control')).toMatchObject({ tone: 'error' });
  expect(await upgrades(page)).toEqual([]);
  // Its "Remove Red" button is the list's: the choice is taken off and checked.
  expect(await say(page, 'remove red', '.rs-control')).toMatchObject({ tone: 'success', message: 'Red taken off Colours.' });
  expect(await chosen(page, 'colours')).toEqual(['Blue', 'Green', 'Yellow']);
});

test('options of a multi-select listbox are added and taken off by name, never toggled off by choosing them', async ({ page }) => {
  await setup(page);
  expect(await say(page, 'choose leather seats', '#up')).toMatchObject({ tone: 'success', message: 'Leather seats chosen in Upgrades.' });
  expect(await say(page, 'select leather seats', '#up')).toMatchObject({ tone: 'success', message: 'Leather seats is already chosen in Upgrades.' });
  expect(await upgrades(page)).toEqual(['Leather seats']);
  expect(await say(page, 'choose front seat warmers and rear bucket seats', '#up')).toMatchObject({ tone: 'success', message: 'Front seat warmers and Rear bucket seats chosen in Upgrades.' });
  expect(await say(page, 'deselect leather seats', '#up')).toMatchObject({ tone: 'success', message: 'Leather seats taken off Upgrades.' });
  expect(await say(page, 'deselect leather seats', '#up')).toMatchObject({ tone: 'success', message: 'Leather seats is not chosen in Upgrades.' });
  expect(await upgrades(page)).toEqual(['Front seat warmers', 'Rear bucket seats']);
  expect(await page.evaluate(() => window.events.filter(event => event[0] === 'up').length)).toBe(4);
});
