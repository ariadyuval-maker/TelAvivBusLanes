import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// An explicit allowlist prevents shipping tools, reports or repository metadata.
const files = ['app.js', 'mobile-layout.css', 'bus_lane_hours.js',
    'camera-data.js', 'voice-controls.js', 'community_reports.js',
    'shared_reports.json', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const destination = path.join(root, 'artifacts', 'mobile-web');
let html = await readFile(path.join(root, 'index.html'), 'utf8');
// The native shell owns updates. Do not register a website service worker there.
html = html.replace('<head>', '<head>\n    <script>window.BUSLANES_NATIVE_BUNDLE = true;</script>');
await mkdir(destination, { recursive: true });
for (const file of files) await copyFile(path.join(root, file), path.join(destination, file));
await writeFile(path.join(destination, 'index.html'), html, 'utf8');
console.log(`Prepared web assets: ${destination}`);
console.log('Leaflet CDN, map tiles and municipal services still require network access.');
