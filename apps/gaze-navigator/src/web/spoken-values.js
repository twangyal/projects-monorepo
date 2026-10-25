// Spoken values: turns what a speech recognizer produces ("November first", "two thirty p.m.", "forty two")
// into the literal values native fields accept (2026-11-01, 14:30, 42). Each parser returns null when the
// words are not a value it understands, so the caller can explain what to say instead.

const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { thousand: 1e3, million: 1e6 };
const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ALIASES = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const pad = (value, length = 2) => String(value).padStart(length, '0');

// Lowercase words with punctuation removed, keeping digits, ":" and "." inside numbers.
function words(text) {
  return String(text ?? '').toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\b([ap])\.\s?m\.?/g, '$1m')
    .replace(/[^\p{L}\p{N}:.\s-]+/gu, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/-/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
}

/** A whole number from words in their usual order ("forty two", "one hundred and five"), or null. */
function wholeNumber(tokens) {
  if (!tokens.length) return null;
  let total = 0, chunk = 0, last = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^\d+$/.test(token)) {
      if (last !== null && last !== 'scale') return null;
      chunk = Number(token); last = 'digits';
    } else if (token === 'a' && ['hundred', 'thousand', 'million'].includes(tokens[i + 1]) && last === null) {
      chunk = 1; last = 'unit';
    } else if (token in UNITS) {
      if (![null, 'tens', 'hundred', 'scale'].includes(last) || (last === 'tens' && UNITS[token] === 0)) return null;
      chunk += UNITS[token]; last = 'unit';
    } else if (token in TEENS) {
      if (![null, 'hundred', 'scale'].includes(last)) return null;
      chunk += TEENS[token]; last = 'teen';
    } else if (token in TENS) {
      if (![null, 'hundred', 'scale'].includes(last)) return null;
      chunk += TENS[token]; last = 'tens';
    } else if (token === 'hundred') {
      if (!['unit', 'digits'].includes(last) || chunk >= 10 || chunk === 0) return null;
      chunk *= 100; last = 'hundred';
    } else if (token in SCALES) {
      if (last === null || last === 'scale') return null;
      total += chunk * SCALES[token]; chunk = 0; last = 'scale';
    } else if (token === 'and' && ['hundred', 'scale'].includes(last)) {
      continue;
    } else {
      return null;
    }
  }
  return total + chunk;
}

/** A decimal number as a string ("3", "-2", "3.14", "2.5"), from digits or words; null otherwise. */
export function spokenNumber(text) {
  const literal = String(text ?? '').trim().replace(/(\d),(?=\d{3}\b)/g, '$1');
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(literal)) return literal.replace(/^\+/, '').replace(/\.$/, '');
  // A unit is not part of the number; sliders strip "percent" themselves.
  if (/%/.test(literal)) return null;
  let tokens = words(text);
  let sign = '';
  if (['minus', 'negative'].includes(tokens[0])) { sign = '-'; tokens = tokens.slice(1); }
  let half = false;
  if (tokens.slice(-3).join(' ') === 'and a half') { half = true; tokens = tokens.slice(0, -3); }
  const point = tokens.indexOf('point');
  const whole = wholeNumber(point < 0 ? tokens : tokens.slice(0, point));
  if (whole === null) return null;
  let fraction = '';
  if (point >= 0) {
    const digits = tokens.slice(point + 1).map(token => /^\d$/.test(token) ? token : token === 'oh' ? '0' : token in UNITS ? String(UNITS[token]) : null);
    if (!digits.length || digits.includes(null)) return null;
    fraction = digits.join('');
  }
  if (half) {
    if (fraction) return null;
    fraction = '5';
  }
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** A slider value: a spoken number, optionally followed by "percent". */
export function spokenSliderValue(text) {
  return spokenNumber(String(text ?? '').replace(/\s*(?:%|per ?cent)\s*$/i, ''));
}

function dayOfMonth(tokens) {
  if (tokens.length === 1) {
    const [token] = tokens;
    const digits = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(token);
    if (digits) return Number(digits[1]);
    if (token in ORDINAL_WORDS) return ORDINAL_WORDS[token];
  }
  if (tokens.length === 2 && ['twenty', 'thirty'].includes(tokens[0]) && tokens[1] in ORDINAL_WORDS && ORDINAL_WORDS[tokens[1]] < 10) {
    return TENS[tokens[0]] + ORDINAL_WORDS[tokens[1]];
  }
  const number = wholeNumber(tokens);
  return number !== null && number >= 1 && number <= 31 ? number : null;
}

// Years as digits, "two thousand twenty six", or in pairs: "twenty twenty six", "nineteen ninety".
function year(tokens) {
  if (tokens.length === 1 && /^\d{4}$/.test(tokens[0])) return Number(tokens[0]);
  if (tokens.length >= 2 && (tokens[0] === 'twenty' || tokens[0] === 'nineteen')) {
    const rest = tokens.slice(1);
    const tail = rest[0] === 'oh' ? wholeNumber(rest.slice(1)) : rest.length === 1 && rest[0] === 'hundred' ? 0 : wholeNumber(rest);
    if (tail !== null && tail < 100 && !(rest[0] === 'oh' && tail >= 10)) return (tokens[0] === 'twenty' ? 2000 : 1900) + tail;
  }
  const number = wholeNumber(tokens);
  return number !== null && number >= 1000 && number <= 9999 ? number : null;
}

function monthIndex(token) {
  const index = MONTHS.indexOf(token);
  return index >= 0 ? index : MONTH_ALIASES[token] ?? null;
}

const daysIn = (yearValue, month) => new Date(Date.UTC(yearValue, month + 1, 0)).getUTCDate();
const isoDate = date => `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

// Split day and year words: "twenty first twenty twenty six" is day 21 of 2026.
function dayAndYear(tokens) {
  for (let split = tokens.length; split >= 1; split--) {
    const day = dayOfMonth(tokens.slice(0, split));
    const rest = tokens.slice(split);
    if (day === null) continue;
    if (!rest.length) return { day, year: null };
    const value = year(rest[0] === 'of' ? rest.slice(1) : rest);
    if (value !== null) return { day, year: value };
  }
  return null;
}

/**
 * A YYYY-MM-DD date. Without a year, the next such date (today or later) is used, since spoken dates in
 * forms are usually upcoming. "11/01/2026" is refused: its day/month order differs by region.
 */
export function spokenDate(text, now = new Date()) {
  const literal = String(text ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(literal)) return literal;
  const today = startOfDay(now);
  const tokens = words(text).filter(token => token !== 'the' && token !== 'on');
  const phrase = tokens.join(' ');
  if (phrase === 'today') return isoDate(today);
  if (phrase === 'tomorrow') return isoDate(addDays(today, 1));
  if (phrase === 'yesterday') return isoDate(addDays(today, -1));
  if (phrase === 'day after tomorrow') return isoDate(addDays(today, 2));
  const weekday = /^(?:(this|next|coming) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(phrase);
  if (weekday) {
    let ahead = (WEEKDAYS.indexOf(weekday[2]) - today.getDay() + 7) % 7;
    if (ahead === 0 && weekday[1] === 'next') ahead = 7;
    return isoDate(addDays(today, ahead));
  }
  const at = tokens.findIndex(token => monthIndex(token) !== null);
  if (at < 0) return null;
  const month = monthIndex(tokens[at]);
  if (at > 0) {
    // "first of November 2026", "1 November".
    const before = tokens.slice(0, at).filter(token => token !== 'of');
    const after = tokens.slice(at + 1);
    const day = dayOfMonth(before);
    if (day === null) return null;
    const value = after.length ? year(after) : null;
    if (after.length && value === null) return null;
    return buildDate(today, month, day, value);
  }
  const parts = dayAndYear(tokens.slice(1));
  if (!parts) return null;
  return buildDate(today, month, parts.day, parts.year);
}

function buildDate(today, month, day, yearValue) {
  let resolved = yearValue ?? today.getFullYear();
  if (day > daysIn(resolved, month)) return null;
  if (yearValue === null && new Date(resolved, month, day) < today) {
    resolved += 1;
    if (day > daysIn(resolved, month)) return null;
  }
  return `${pad(resolved, 4)}-${pad(month + 1)}-${pad(day)}`;
}

function minutes(tokens) {
  if (!tokens.length || ['o clock', 'oclock', 'hundred'].includes(tokens.join(' '))) return 0;
  if (tokens[0] === 'oh' && tokens.length === 2 && tokens[1] in UNITS) return UNITS[tokens[1]];
  if (tokens.length === 1 && /^\d{2}$/.test(tokens[0])) return Number(tokens[0]);
  const value = wholeNumber(tokens);
  return value !== null && value <= 59 && !/^\d$/.test(tokens.join('')) ? value : null;
}

/**
 * A 24-hour HH:MM time. "am"/"pm", "noon", "midnight", "half past two" and "quarter to three" are
 * understood; without am/pm the hour is taken as said on a 24-hour clock ("two thirty" is 02:30).
 */
export function spokenTime(text) {
  const literal = String(text ?? '').trim();
  if (/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(literal)) return literal;
  let tokens = words(text).filter(token => token !== 'at');
  let phrase = tokens.join(' ');
  if (['noon', 'midday', '12 noon', 'twelve noon'].includes(phrase)) return '12:00';
  if (['midnight', '12 midnight', 'twelve midnight'].includes(phrase)) return '00:00';
  let meridiem = null;
  const suffix = /\s(am|pm|in the morning|in the afternoon|in the evening|at night|tonight)$/.exec(` ${phrase}`);
  if (suffix) {
    meridiem = ['am', 'in the morning'].includes(suffix[1]) ? 'am' : 'pm';
    phrase = phrase.slice(0, phrase.length - suffix[1].length).trim();
    tokens = phrase ? phrase.split(' ') : [];
  }
  let hour = null, minute = null;
  const relative = /^(half|quarter|.+?)(?: minutes?)? (past|after|to|before) (.+)$/.exec(phrase);
  const clock = /^(\d{1,2})(?::(\d{2}))?$/.exec(phrase) ?? /^(\d{1,2}) (\d{2})$/.exec(phrase);
  if (clock) {
    hour = Number(clock[1]); minute = clock[2] === undefined ? 0 : Number(clock[2]);
  } else if (relative) {
    const offset = relative[1] === 'half' ? 30 : relative[1] === 'quarter' ? 15 : minutes(relative[1].split(' '));
    const base = wholeNumber(relative[3].split(' '));
    if (offset === null || offset === 0 || base === null || base > 23) return null;
    const before = relative[2] === 'to' || relative[2] === 'before';
    hour = before ? (base + 23) % 24 : base;
    minute = before ? 60 - offset : offset;
  } else {
    for (let split = 1; split <= tokens.length && hour === null; split++) {
      const h = wholeNumber(tokens.slice(0, split));
      const m = minutes(tokens.slice(split));
      if (h !== null && h <= 23 && m !== null) { hour = h; minute = m; }
    }
  }
  if (hour === null || minute === null || hour > 23 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem === 'pm' ? 12 : 0);
  }
  return `${pad(hour)}:${pad(minute)}`;
}

/** A YYYY-MM month: "November 2026", "November" (this year), "this month", "next month", "last month". */
export function spokenMonth(text, now = new Date()) {
  const literal = String(text ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(literal)) return literal;
  const tokens = words(text).filter(token => token !== 'the' && token !== 'of');
  const phrase = tokens.join(' ');
  const relative = { 'this month': 0, 'next month': 1, 'last month': -1, 'previous month': -1 }[phrase];
  if (relative !== undefined) {
    const date = new Date(now.getFullYear(), now.getMonth() + relative, 1);
    return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}`;
  }
  const month = monthIndex(tokens[0]);
  if (month === null) return null;
  const value = tokens.length > 1 ? year(tokens.slice(1)) : now.getFullYear();
  return value === null ? null : `${pad(value, 4)}-${pad(month + 1)}`;
}

// ISO 8601 week-numbering year and week of a local date.
function isoWeek(date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return { year: day.getUTCFullYear(), week: Math.ceil(((day - yearStart) / 86400000 + 1) / 7) };
}

const weeksIn = yearValue => isoWeek(new Date(yearValue, 11, 28)).week;

/** A YYYY-Www ISO week: "week 43", "week forty three of 2026", "this week", "next week", "last week". */
export function spokenWeek(text, now = new Date()) {
  const literal = String(text ?? '').trim();
  if (/^\d{4}-W\d{2}$/.test(literal)) return literal;
  const tokens = words(text).filter(token => token !== 'the');
  const phrase = tokens.join(' ');
  const relative = { 'this week': 0, 'next week': 7, 'last week': -7, 'previous week': -7 }[phrase];
  if (relative !== undefined) {
    const { year: yearValue, week } = isoWeek(addDays(startOfDay(now), relative));
    return `${pad(yearValue, 4)}-W${pad(week)}`;
  }
  if (tokens[0] !== 'week') return null;
  const of = tokens.indexOf('of');
  const weekTokens = tokens.slice(1, of < 0 ? undefined : of);
  let yearValue = of < 0 ? null : year(tokens.slice(of + 1));
  let week = wholeNumber(weekTokens);
  if (week === null && of < 0) {
    // "week 43 2026": the year follows the week number directly.
    for (let split = weekTokens.length - 1; split >= 1 && week === null; split--) {
      const candidate = year(weekTokens.slice(split));
      const number = wholeNumber(weekTokens.slice(0, split));
      if (candidate !== null && number !== null) { week = number; yearValue = candidate; }
    }
  }
  if (week === null || (of >= 0 && yearValue === null)) return null;
  yearValue ??= isoWeek(now).year;
  if (week < 1 || week > weeksIn(yearValue)) return null;
  return `${pad(yearValue, 4)}-W${pad(week)}`;
}
