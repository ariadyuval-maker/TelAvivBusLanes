import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function appContext() {
    const context = vm.createContext({
        window: {}, document: { addEventListener() {} }, navigator: {},
        console, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}
    });
    const root = new URL('../', import.meta.url);
    vm.runInContext(readFileSync(new URL('bus_lane_hours.js', root), 'utf8') + '\n' + readFileSync(new URL('app.js', root), 'utf8'), context);
    return context;
}

test('Tel Giborim source rows retain both daily operating windows', () => {
    const context = appContext();
    for (const street of ['תל גיבורים', 'תל גבורים']) {
        for (const direction of ['N', 'S']) {
            context.feature = { attributes: { street_name: street, direction_name: direction, from_street: 'הלוחמים', to_street: 'בן צבי', status: 'פעיל' } };
            for (const [day, hour, minute, expected] of [
                [4,5,59,'open'], [4,6,0,'blocked'], [4,9,59,'blocked'],
                [4,10,0,'open'], [4,13,59,'open'], [4,14,0,'blocked'],
                [4,18,59,'blocked'], [4,19,0,'open'],
                [5,9,0,'blocked'], [5,11,0,'open'], [5,16,59,'blocked'],
                [5,17,0,'open'], [6,9,0,'open']
            ]) {
                context.now = { getDay: () => day, getHours: () => hour, getMinutes: () => minute };
                const result = vm.runInContext('getLaneStatus(feature, now)', context);
                assert.equal(result.category, expected, `${street} ${direction} day ${day} ${hour}:${minute}`);
                assert.deepEqual(Array.from(result.schedule.sun_thu, range => Array.from(range)), [[6,10],[14,19]]);
                assert.deepEqual(Array.from(result.schedule.fri, range => Array.from(range)), [[6,10],[14,17]]);
            }
        }
    }
});

test('existing Shoken lanes use their matched direction and daily hours', () => {
    const context = appContext();
    for (const status of ['קיים', ' קיים ', 'פעיל']) {
        for (const [direction, from, to, day, hour, minute, expected] of [
            ['S','דרך שלמה','קיבוץ גלויות',4,16,43,'blocked'],
            ['S','דרך שלמה','קיבוץ גלויות',4,9,59,'open'],
            ['S','דרך שלמה','קיבוץ גלויות',4,10,0,'blocked'],
            ['S','דרך שלמה','קיבוץ גלויות',4,19,0,'open'],
            ['S','דרך שלמה','קיבוץ גלויות',5,16,59,'blocked'],
            ['S','דרך שלמה','קיבוץ גלויות',5,17,0,'open'],
            ['N','קיבוץ גלויות','בר יוחאי',4,8,0,'blocked'],
            ['N','קיבוץ גלויות','בר יוחאי',4,16,43,'open'],
            ['N','קיבוץ גלויות','בר יוחאי',5,12,0,'blocked']
        ]) {
            context.feature = {attributes:{street_name:'שוקן',direction_name:direction,from_street:from,to_street:to,status}};
            context.now = {getDay:()=>day,getHours:()=>hour,getMinutes:()=>minute};
            const result = vm.runInContext('getLaneStatus(feature, now)',context);
            assert.equal(result.category,expected,`${status} ${direction} day ${day} ${hour}:${minute}`);
            assert.ok(result.schedule,'Matched hours must remain visible in the popup');
        }
    }
});

test('existing lane without matched hours stays unknown rather than open', () => {
    const context = appContext();
    context.feature = {attributes:{street_name:'רחוב ללא רשומת שעות',status:'קיים'}};
    context.now = {getDay:()=>4,getHours:()=>16,getMinutes:()=>43};
    const result = vm.runInContext('getLaneStatus(feature, now)',context);
    assert.equal(result.category,'unknown');
    assert.equal(result.blocked,true);
});

test('live GIS existing Shoken subsegments match Hebrew direction codes', () => {
    const captured = JSON.parse(readFileSync(new URL('fixtures/gis-existing-2026-11-26.json', import.meta.url), 'utf8'));
    const context = appContext();
    for (const attributes of captured.records.filter(row => row.street_name === 'שוקן')) {
        context.feature = {attributes};
        context.now = {getDay:()=>4,getHours:()=>16,getMinutes:()=>43};
        const result = vm.runInContext('getLaneStatus(feature, now)',context);
        assert.equal(result.category,attributes.direction_name === 'דר' ? 'blocked' : 'open',`Real GIS oid ${attributes.oid}`);
        assert.match(result.schedule.section,attributes.direction_name === 'דר' ? /דרום/ : /צפון/);
    }
});
