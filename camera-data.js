(function (global) {
    'use strict';

    function validateFeatures(features, expectedIds, idField = 'OBJECTID') {
        if (!Array.isArray(features) || !features.length || !Array.isArray(expectedIds) || features.length !== expectedIds.length) throw Error('Incomplete camera list');
        const expected = new Set(expectedIds);
        const seen = new Set();
        if (expected.size !== expectedIds.length) throw Error('Duplicate expected camera IDs');
        return features.map(feature => {
            const id = feature?.attributes?.[idField];
            const g = feature?.geometry;
            if (!Number.isSafeInteger(id) || !expected.has(id) || seen.has(id)) throw Error('Missing, duplicate or unexpected camera ID');
            if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y) || Math.abs(g.x) > 180 || Math.abs(g.y) > 90) throw Error('Invalid camera location');
            seen.add(id);
            return { ...feature, attributes: { ...feature.attributes, OBJECTID: id } };
        });
    }

    function createLoader({ baseUrl, fetchImpl = global.fetch.bind(global), storage, timeoutMs = 15000, batchSize = 200, now = () => new Date().toISOString() }) {
        if (!Number.isInteger(batchSize) || batchSize < 1) throw Error('Invalid batch size');
        const key = `buslanes-cameras-v1:${baseUrl}`;
        let lastGood;
        if (storage === undefined) { try { storage = global.localStorage; } catch { storage = null; } }
        try {
            const cached = JSON.parse(storage?.getItem(key) || 'null');
            if (cached?.version === 1 && cached.source === baseUrl && Number.isFinite(Date.parse(cached.savedAt))) {
                cached.features = validateFeatures(cached.features, cached.ids);
                lastGood = cached;
            }
        } catch { /* A corrupt cache is never used. */ }

        async function query(params) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetchImpl(`${baseUrl}/query?${new URLSearchParams({ f: 'json', ...params })}`, { cache: 'no-store', signal: controller.signal });
                if (!response.ok) throw Error(`Camera API HTTP ${response.status}`);
                const data = await response.json();
                if (!data || data.error) throw Error(data?.error?.message || 'Invalid camera API response');
                return data;
            } finally { clearTimeout(timeout); }
        }

        async function getIds() {
            const data = await query({ where: '1=1', returnIdsOnly: 'true' });
            if (!Array.isArray(data.objectIds) || !data.objectIds.length || data.exceededTransferLimit === true || data.objectIds.some(id => !Number.isSafeInteger(id)) || new Set(data.objectIds).size !== data.objectIds.length) throw Error('Invalid or empty camera ID list');
            if (typeof data.objectIdFieldName !== 'string' || !data.objectIdFieldName) throw Error('Missing camera ID field');
            return { ids: data.objectIds.slice().sort((a,b) => a-b), field: data.objectIdFieldName };
        }

        async function load() {
            try {
                // ID queries are not subject to ArcGIS feature transfer limits.
                const before = await getIds();
                const features = [];
                for (let offset = 0; offset < before.ids.length; offset += batchSize) {
                    const ids = before.ids.slice(offset, offset + batchSize);
                    const data = await query({ objectIds: ids.join(','), outFields: '*', outSR: '4326', returnGeometry: 'true' });
                    if (data.exceededTransferLimit === true) throw Error('Truncated camera batch');
                    features.push(...validateFeatures(data.features, ids, before.field));
                }
                const after = await getIds();
                if (before.field !== after.field || JSON.stringify(before.ids) !== JSON.stringify(after.ids)) throw Error('Camera list changed while loading');
                const complete = validateFeatures(features, before.ids);
                const snapshot = { version: 1, source: baseUrl, savedAt: now(), ids: before.ids, features: complete };
                let persisted = false;
                try { if (storage) { storage.setItem(key, JSON.stringify(snapshot)); persisted = true; } } catch { /* Preserve usable data in this visit if storage is full. */ }
                lastGood = snapshot;
                return { features: complete, source: 'live', savedAt: snapshot.savedAt, persisted };
            } catch (error) {
                if (lastGood) return { features: lastGood.features, source: 'cache', savedAt: lastGood.savedAt, error: String(error.message || error) };
                return { features: [], source: 'unavailable', savedAt: null, error: String(error.message || error) };
            }
        }
        return { load };
    }
    global.BusLaneCameraData = { createLoader, validateFeatures };
})(window);
