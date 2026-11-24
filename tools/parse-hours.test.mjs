import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRow, validatePages } from './parse-hours.mjs';
const row = hours => ['רחוב לדוגמה', 'קטע לבדיקה', hours, '1991'];
test('municipality formats: multiple windows, RTL, Friday and Sabbath', () => {
    const [a] = parseRow(row("בימים א'–ה' משעה 06:00 עד 10:00 ומשעה 14:00 עד 19:00. בימי ו' משעה 06:00 עד 10:00 ומשעה 14:00 עד 17:00"));
    assert.deepEqual(a.sun_thu, [[6,10],[14,19]]);
    assert.deepEqual(a.fri, [[6,10],[14,17]]);
    const [b] = parseRow(row("בימים א'-ה' משעה 05:00 עד 22:00 ובימי ו' בשעות 17:00-05:00"));
    assert.deepEqual(b.fri, [[5,17]]);
    const [c] = parseRow(row("בימים א'-ה' משעה 5:00 עד 21:00, בימי ו' מ-5:00 עד 16:00, בימי שבת מ-17:00 עד 22:00"));
    assert.deepEqual(c.sat, [[17,22]]);
});
test('shared Sunday-Friday, weekday only, all day', () => {
    assert.deepEqual(parseRow(row("בימים א'-ו' משעה 07:00 עד 14:00"))[0].fri, [[7,14]]);
    assert.equal(parseRow(row("בימים א'-ה' משעה 08:00-20:00"))[0].fri, null);
    assert.equal(parseRow(row('כל ימות השבוע, בכל שעות היממה'))[0].allWeek, true);
    assert.equal(parseRow(row('כל שעות היממה'))[0].allWeek, true);
});
test('directions have separate schedules', () => {
    const entries = parseRow(row("בימים א'-ה' לכיוון מערב-מ-6:00 עד 10:00 לכיוון מזרח מ-16:00 עד 19:00 ובימי ו' לכיוון מערב-מ-6:00 עד 10:00 לכיוון מזרח מ-16:00 עד 17:00"));
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0].sun_thu, [[6,10]]);
    assert.deepEqual(entries[1].fri, [[16,17]]);
});
test('singular Friday and municipality short time formats', () => {
    const [entry] = parseRow(row("בימים א'- ה' מ08:00 עד 11:00 ומשעה 14:00 עד 21:00 ביום ו' מ 08:00- 11:00 ומשעה 14:00- 17:00"));
    assert.deepEqual(entry.fri, [[8,11],[14,17]]);
    assert.deepEqual(parseRow(row("בימים א' עד ה': משעה 10:00 עד 19:0 ובימי ו' משעה 10:00 עד 17:00"))[0].sun_thu, [[10,19]]);
});
test('reject missing, repeated, blank and uncaptured pages', () => {
    const p = { number: 1, rows: [row('כל שעות היממה')], screenshotValid: true };
    assert.equal(validatePages([p], 1).length, 1);
    assert.throws(() => validatePages([p], 2));
    assert.throws(() => validatePages([p, {...p, number: 2}], 2));
    assert.throws(() => validatePages([{...p, screenshotValid: false}], 1));
    assert.throws(() => validatePages([{...p, rows: []}], 1));
});
test('reject unknown days, incomplete and invalid hours', () => {
    for (const hours of ['תקלה', "בימים א'-ה' משעה 25:00 עד 26:00", "בימים א'-ה' משעה 08:00 עד", "בימים א'-ה' משעה 08:80 עד 20:00", "בימים א'-ה' משעה 08:00 עד 20:00 למעט יום שלישי"]) assert.throws(() => parseRow(row(hours)));
});
test('published schedules reproduce the complete retained source table', () => {
    const capture = JSON.parse(readFileSync(new URL('../data/municipality-hours.json', import.meta.url), 'utf8'));
    assert.equal(capture.pages.length, capture.pageCount);
    const entries = validatePages(capture.pages.map(p => ({...p, screenshotValid: true})), capture.pageCount);
    assert.equal(capture.pages.reduce((sum, p) => sum + p.rows.length, 0), capture.rowCount);
    assert.equal(entries.length, capture.entries.length);
    assert.deepEqual(entries, capture.entries);
});
