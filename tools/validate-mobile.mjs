import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function validateMobile(root) {
    const config = JSON.parse(await readFile(path.join(root, 'capacitor.config.json'), 'utf8'));
    const bundle = path.resolve(root, config.webDir);
    if (bundle !== path.join(root, 'artifacts', 'mobile-web')) throw Error('Unexpected mobile webDir');
    const html = await readFile(path.join(bundle, 'index.html'), 'utf8');
    if (!html.includes('window.BUSLANES_NATIVE_BUNDLE = true')) throw Error('Native bundle flag missing');
    const forbidden = ['tools', '.git', '.github', 'ios-preview.html', 'sw.js'];
    const entries = await readdir(bundle);
    for (const name of forbidden) if (entries.includes(name)) throw Error(`Unexpected bundle entry: ${name}`);
    const external = [];
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        const reference = match[1];
        if (/^(https?:)?\/\//.test(reference)) { external.push(reference); continue; }
        if (/^(data:|#)/.test(reference)) continue;
        const filename = path.resolve(bundle, reference.split(/[?#]/)[0]);
        if (!filename.startsWith(bundle + path.sep)) throw Error(`Reference outside bundle: ${reference}`);
        await access(filename).catch(() => { throw Error(`Missing local resource: ${reference}`); });
    }
    return { files: entries.length, external };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await validateMobile(fileURLToPath(new URL('../', import.meta.url)));
    console.log(JSON.stringify(result, null, 2));
}
