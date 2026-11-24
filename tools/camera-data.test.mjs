import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../camera-data.js', import.meta.url), 'utf8');
const baseUrl = 'https://example.test/MapServer/949';
const feature = (id, x = 34.78) => ({ attributes: { OBJECTID: id, status: 'active' }, geometry: { x, y: 32.08 } });
const ids = (...values) => ({ objectIdFieldName: 'OBJECTID', objectIds: values });
function memory() { const data = new Map(); return { getItem: k => data.get(k) || null, setItem: (k,v) => data.set(k,v), data }; }
function api() {
    const window = {};
    vm.runInNewContext(code, { window, AbortController, URLSearchParams, setTimeout, clearTimeout });
    return window.BusLaneCameraData;
}
function fetchSequence(items) {
    const pending = [...items];
    return async (url, options) => {
        assert.equal(options.cache, 'no-store');
        if (!pending.length) throw Error('Unexpected request');
        const item = pending.shift();
        if (item instanceof Error) throw item;
        const data = typeof item === 'function' ? item(new URL(url).searchParams) : item;
        return { ok: true, json: async () => data };
    };
}
function create(items, storage = memory(), extra = {}) {
    return api().createLoader({ baseUrl, fetchImpl: fetchSequence(items), storage, batchSize: 1, now: () => '2026-11-24T14:00:00.000Z', ...extra });
}

test('complete ID-based batches are validated and persisted', async () => {
    const store = memory();
    const loader = create([ids(2,1), p => { assert.equal(p.get('objectIds'), '1'); assert.equal(p.get('outSR'), '4326'); return {features:[feature(1)]}; }, {features:[feature(2)]}, ids(1,2)], store);
    const result = await loader.load();
    assert.equal(result.source, 'live'); assert.equal(result.features.length, 2); assert.equal(result.persisted, true);
    assert.equal(JSON.parse([...store.data.values()][0]).features.length, 2);
});
test('a failed later batch returns the entire last good snapshot, never a partial update', async () => {
    const store = memory();
    await create([ids(1), {features:[feature(1)]}, ids(1)], store).load();
    const original = [...store.data.values()][0];
    const result = await create([ids(1,2), {features:[feature(1,34.9)]}, Error('Network failure')], store).load();
    assert.equal(result.source, 'cache'); assert.equal(result.features.length, 1);
    assert.equal(result.features[0].geometry.x, 34.78); assert.equal([...store.data.values()][0], original);
});
test('empty IDs and API errors preserve the cache', async () => {
    const store = memory();
    await create([ids(1), {features:[feature(1)]}, ids(1)], store).load();
    for (const response of [ids(), {error:{message:'Service down'}}, {hello:'wrong schema'}]) {
        assert.equal((await create([response], store).load()).source, 'cache');
    }
});
test('missing, repeated, unexpected, truncated and invalid camera features are rejected', async () => {
    for (const response of [
        {features:[]}, {features:[feature(2)]},
        {features:[feature(1)], exceededTransferLimit:true},
        {features:[feature(1,NaN)]}, {features:[feature(1,10000)]},
        {features:[{attributes:{OBJECTID:1},geometry:null}]},
        {features:[feature(1),feature(1)]}
    ]) {
        const store = memory();
        const result = await create([ids(1),response], store).load();
        assert.equal(result.source, 'unavailable'); assert.equal(result.features.length, 0); assert.equal(store.data.size, 0);
    }
});
test('a changing ID set is rejected; confirmed deletions on a later load are accepted', async () => {
    const store = memory();
    const incomplete = await create([ids(1),{features:[feature(1)]},ids(1,2)],store).load();
    assert.equal(incomplete.source,'unavailable'); assert.equal(store.data.size,0);
    await create([ids(1,2),{features:[feature(1)]},{features:[feature(2)]},ids(1,2)],store).load();
    const complete = await create([ids(2),{features:[feature(2)]},ids(2)],store).load();
    assert.equal(complete.source,'live'); assert.equal(complete.features.length,1); assert.equal(complete.features[0].attributes.OBJECTID,2);
});
test('corrupt stored data is not treated as a last good snapshot', async () => {
    const store = memory();
    store.setItem(`buslanes-cameras-v1:${baseUrl}`, JSON.stringify({version:1,source:baseUrl,savedAt:'2026-11-22',ids:[1],features:[]}));
    assert.equal((await create([Error('Offline')],store).load()).source,'unavailable');
});
test('storage quota failure keeps a good in-memory snapshot for the current visit', async () => {
    const storage = {getItem:()=>null,setItem:()=>{throw Error('Quota exceeded');}};
    const loader = create([ids(1),{features:[feature(1)]},ids(1),Error('Offline')],storage);
    assert.equal((await loader.load()).persisted,false);
    assert.equal((await loader.load()).source,'cache');
});
test('hanging requests time out without clearing stored cameras', async () => {
    const loader = create([], null, { timeoutMs:5, fetchImpl: (url,{signal}) => new Promise((resolve,reject) => signal.addEventListener('abort',()=>reject(Error('Timeout')))) });
    const result = await loader.load();
    assert.equal(result.source,'unavailable'); assert.match(result.error,/Timeout/);
});
