import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenDate, spokenMonth, spokenNumber, spokenSliderValue, spokenTime, spokenWeek } from '../src/web/spoken-values.js';

// Sunday 25 October 2026, local time.
const now = new Date(2026, 9, 25, 10, 0);

test('numbers from digits and words', () => {
  const cases = {
    '3': '3', '+3': '3', '-2.5': '-2.5', '1,200': '1200', three: '3', 'forty two': '42', 'forty-two': '42',
    'one hundred and five': '105', 'a hundred': '100', 'two thousand twenty six': '2026', 'three point one four': '3.14',
    'minus two': '-2', 'negative seven': '-7', 'two and a half': '2.5', zero: '0',
  };
  for (const [said, value] of Object.entries(cases)) assert.equal(spokenNumber(said), value, said);
  for (const said of ['three two', 'twenty twelve', 'hundred', 'NaN', 'Infinity', '1e3', '3%', 'lots', '']) assert.equal(spokenNumber(said), null, said);
});

test('slider values may say percent', () => {
  assert.equal(spokenSliderValue('forty percent'), '40');
  assert.equal(spokenSliderValue('40%'), '40');
  assert.equal(spokenSliderValue('forty'), '40');
});

test('dates from spoken words, defaulting to the next such date', () => {
  const cases = {
    '2026-11-01': '2026-11-01', 'November first': '2026-11-01', 'November 1st': '2026-11-01', 'november 1st, 2027': '2027-11-01',
    'the first of November': '2026-11-01', '1 November 2026': '2026-11-01', 'March twenty first': '2027-03-21',
    'November twenty first twenty twenty six': '2026-11-21', 'Dec 31': '2026-12-31', today: '2026-10-25', tomorrow: '2026-10-26',
    yesterday: '2026-10-24', 'the day after tomorrow': '2026-10-27', friday: '2026-10-30', 'next Sunday': '2026-11-01', sunday: '2026-10-25',
    'February 29 2028': '2028-02-29',
  };
  for (const [said, value] of Object.entries(cases)) assert.equal(spokenDate(said, now), value, said);
  for (const said of ['11/01/2026', 'November', 'November 2026', 'February 30', 'February 29 2027', 'someday', '']) assert.equal(spokenDate(said, now), null, said);
});

test('times from clock readings and phrases', () => {
  const cases = {
    '14:30': '14:30', '9:05': '09:05', '2:30 pm': '14:30', '2:30 p.m.': '14:30', '2:30 PM': '14:30', '2 30 pm': '14:30',
    'two thirty': '02:30', 'two thirty pm': '14:30', 'two oh five pm': '14:05', 'twenty three fifteen': '23:15', 'fourteen hundred': '14:00',
    'nine o\'clock': '09:00', 'three pm': '15:00', '12 am': '00:00', '12 pm': '12:00', noon: '12:00', midnight: '00:00',
    'half past two': '02:30', 'half past two in the afternoon': '14:30', 'quarter to three pm': '14:45', 'ten past nine am': '09:10',
    'at seven in the evening': '19:00',
  };
  for (const [said, value] of Object.entries(cases)) assert.equal(spokenTime(said), value, said);
  for (const said of ['tomorrow', '24:00', '12:60', '12:00:60', '12:00:00.5', '14:30Z', 'thirteen pm', 'two sixty', '']) assert.equal(spokenTime(said), null, said);
});

test('months and ISO weeks', () => {
  assert.equal(spokenMonth('November 2026', now), '2026-11');
  assert.equal(spokenMonth('november', now), '2026-11');
  assert.equal(spokenMonth('next month', now), '2026-11');
  assert.equal(spokenMonth('last month', now), '2026-09');
  assert.equal(spokenMonth('2026-11', now), '2026-11');
  assert.equal(spokenMonth('someday', now), null);
  assert.equal(spokenWeek('week 43', now), '2026-W43');
  assert.equal(spokenWeek('week forty three of twenty twenty six', now), '2026-W43');
  assert.equal(spokenWeek('week 43 2026', now), '2026-W43');
  assert.equal(spokenWeek('this week', now), '2026-W43');
  assert.equal(spokenWeek('next week', now), '2026-W44');
  assert.equal(spokenWeek('week 53', now), '2026-W53');
  assert.equal(spokenWeek('week 53 of 2027', now), null);
  assert.equal(spokenWeek('2026-w43', now), null);
});
