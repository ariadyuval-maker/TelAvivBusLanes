import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateMobile } from './validate-mobile.mjs';

test('bundle validation catches missing resources and accidental tool inclusion', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'buslanes-bundle-'));
    try {
        const bundle = path.join(root, 'artifacts', 'mobile-web');
        await mkdir(bundle, { recursive: true });
        await writeFile(path.join(root, 'capacitor.config.json'), JSON.stringify({ webDir: 'artifacts/mobile-web' }));
        await writeFile(path.join(bundle, 'index.html'), '<head><script>window.BUSLANES_NATIVE_BUNDLE = true;</script><script src="app.js?v=1"></script></head>');
        await assert.rejects(validateMobile(root), /Missing local resource/);
        await writeFile(path.join(bundle, 'app.js'), '');
        assert.equal((await validateMobile(root)).files, 2);
        await mkdir(path.join(bundle, 'tools'));
        await assert.rejects(validateMobile(root), /Unexpected bundle entry/);
    } finally {
        // root is an isolated directory created by mkdtemp for this test.
        await rm(root, { recursive: true, force: true });
    }
});
