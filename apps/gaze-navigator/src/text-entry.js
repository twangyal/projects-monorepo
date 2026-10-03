export function editText(value, start, end, key, maxLength) {
  start = Math.max(0, Math.min(value.length, start ?? value.length));
  end = Math.max(start, Math.min(value.length, end ?? start));
  if (key === 'Backspace') {
    if (start === end && start > 0) {
      const previous = Array.from(value.slice(0, start)).at(-1);
      start -= previous.length;
    }
    return { value: value.slice(0, start) + value.slice(end), caret: start };
  }
  const room = Math.max(0, maxLength - (value.length - (end - start)));
  let inserted = '';
  for (const character of key) {
    if (inserted.length + character.length > room) break;
    inserted += character;
  }
  return { value: value.slice(0, start) + inserted + value.slice(end), caret: start + inserted.length };
}
