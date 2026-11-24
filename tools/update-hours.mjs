import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validatePages } from './parse-hours.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = 'https://www.tel-aviv.gov.il/Residents/Transportation/Pages/Roads.aspx';
const run = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(root, 'artifacts', run);
await mkdir(output, { recursive: true });
let browser;
try {
    let pages = [];
    let total;
    const captureArg = process.argv.indexOf('--from-capture');
    if (captureArg !== -1) {
        if (!process.argv[captureArg + 1]) throw Error('Missing capture directory');
        const directory = path.resolve(process.argv[captureArg + 1]);
        pages = JSON.parse(await readFile(path.join(directory, 'pages.json'), 'utf8'));
        total = pages.length;
        const hashes = new Set();
        for (const item of pages) {
            if (!/^page-\d+\.jpg$/.test(item.image)) throw Error('Invalid image filename');
            const bytes = await readFile(path.join(directory, item.image));
            const hash = createHash('sha256').update(bytes).digest('hex');
            if (bytes.length < 1000 || bytes[0] !== 255 || bytes[1] !== 216 || hashes.has(hash)) throw Error('Invalid or repeated JPEG');
            hashes.add(hash);
            item.screenshotValid = true;
            item.sha256 = hash;
        }
        if (pages.some(p => p.totalPages !== total)) throw Error('Capture does not cover declared pagination');
    } else {
    let playwright;
    try { playwright = await import('playwright'); }
    catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        // Work environments may supply dependencies alongside the Node runtime.
        const runtimeRequire = createRequire(path.resolve(path.dirname(process.execPath), '../node_modules/runtime.cjs'));
        playwright = runtimeRequire('playwright');
    }
    const { chromium } = playwright.default || playwright;
    try { browser = await chromium.launch(); }
    catch (error) {
        if (!String(error).includes("Executable doesn't exist")) throw error;
        // Use an installed browser when the bundled Chromium is unavailable.
        for (const channel of ['msedge', 'chrome']) {
            try { browser = await chromium.launch({ channel }); break; } catch { /* Try next installed browser. */ }
        }
        if (!browser) throw error;
    }
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
    page.setDefaultTimeout(60000);
    const response = await page.goto(source, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (!response?.ok() || new URL(page.url()).hostname !== 'www.tel-aviv.gov.il') throw Error('Municipality page unavailable');
    const table = page.getByRole('table', { name: 'רשימת נתיבי תחבורה ציבורית', exact: true });
    await table.locator('tbody tr td').first().waitFor();
    const nav = page.getByRole('navigation', { name: 'ניווט עמודים', exact: true });
    const active = nav.locator('a.active');
    const label = await active.getAttribute('aria-label');
    const match = /^עמוד 1 מתוך (\d+)$/.exec(label || '');
    if (!match) throw Error(`Cannot determine complete pagination: ${label}`);
    total = Number(match[1]);
    if (total > 100) throw Error('Unexpected page count');
    const hashes = new Set();
    for (let number = 1; number <= total; number++) {
        if (number > 1) await nav.getByRole('link', { name: `עמוד ${number} מתוך ${total}`, exact: true }).click();
        await page.waitForFunction(({number, total}) => document.querySelector('[aria-label="ניווט עמודים"] a.active')?.getAttribute('aria-label') === `עמוד ${number} מתוך ${total}`, { number, total });
        const headers = await table.locator('thead th').allTextContents();
        if (headers.map(s => s.trim()).join('|') !== 'רחוב|קטע|זמני פעילות|השתנה על-ידי') throw Error('Table schema changed');
        const rows = await table.locator('tbody tr').evaluateAll(rs => rs.filter(r => r.getBoundingClientRect().height > 0).map(r => [...r.querySelectorAll('td')].map(c => c.innerText)));
        if (number < total && pages.length && rows.length !== pages[0].rows.length) throw Error('Incomplete intermediate page');
        if (number === total && !(await nav.locator('a.jumpNext').getAttribute('class'))?.split(/\s+/).includes('disabled')) throw Error('Last page is not terminal');
        await page.evaluate(() => document.fonts.ready);
        const image = await table.screenshot({ path: path.join(output, `page-${number}.png`) });
        const png = image.length > 1000 && image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && image.readUInt32BE(16) > 100 && image.readUInt32BE(20) > 50;
        const hash = createHash('sha256').update(image).digest('hex');
        if (hashes.has(hash)) throw Error('Duplicate screenshot');
        hashes.add(hash);
        // Verify screenshot and parsed text describe the same page.
        const after = await table.locator('tbody tr').evaluateAll(rs => rs.filter(r => r.getBoundingClientRect().height > 0).map(r => [...r.querySelectorAll('td')].map(c => c.innerText)));
        if (JSON.stringify(rows) !== JSON.stringify(after)) throw Error('Table changed during capture');
        pages.push({ number, totalPages: total, rows, screenshotValid: png, sha256: hash });
        await writeFile(path.join(output, 'pages.json'), JSON.stringify(pages, null, 2));
    }
    }
    const entries = validatePages(pages, total);
    const previousPath = path.join(root, 'data', 'municipality-hours.json');
    let previous;
    try { previous = JSON.parse(await readFile(previousPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const rowCount = pages.reduce((n, p) => n + p.rows.length, 0);
    if (previous && rowCount < previous.rowCount * 0.8) throw Error('More than 20% of source rows disappeared');
    const payload = { source, capturedAt: new Date().toISOString(), pageCount: total, rowCount, entries, pages: pages.map(({number, rows}) => ({number, rows})) };
    await writeFile(path.join(output, 'validated.json'), JSON.stringify(payload, null, 2));
    // One atomic replacement is the publication gate. No live file is touched before this point.
    const js = `// Generated from ${source}\nconst BUS_LANE_SCHEDULE = ${JSON.stringify(entries, null, 2)};\nconst SCHEDULE_BY_STREET = {};\nfor (const entry of BUS_LANE_SCHEDULE) {\n    (SCHEDULE_BY_STREET[entry.street] ||= []).push(entry);\n}\n`;
    await writeFile(path.join(root, 'bus_lane_hours.js.pending'), js);
    await mkdir(path.dirname(previousPath), { recursive: true });
    await writeFile(previousPath + '.pending', JSON.stringify(payload, null, 2) + '\n');
    await rename(previousPath + '.pending', previousPath);
    await rename(path.join(root, 'bus_lane_hours.js.pending'), path.join(root, 'bus_lane_hours.js'));
    console.log(`Validated ${total} screenshots, ${rowCount} rows, ${entries.length} schedules.`);
} catch (error) {
    await writeFile(path.join(output, 'failure.txt'), String(error.stack || error));
    console.error(error);
    process.exitCode = 1;
} finally {
    await browser?.close();
}
