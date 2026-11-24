import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };
const port = Number(process.env.PORT || 8080);
const server = http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const parts = pathname.split(/[\\/]/).filter(Boolean);
        if (parts.some(p => p.startsWith('.')) || parts.some(p => ['node_modules', 'tools'].includes(p))) { res.writeHead(403); res.end(); return; }
        const filename = path.resolve(root, ...parts, ...(parts.length ? [] : ['index.html']));
        if (!filename.startsWith(root)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(filename);
        res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port} (refresh after edits; Ctrl+C to stop)`));
