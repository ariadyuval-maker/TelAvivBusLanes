import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseRow, clean } from './parse-hours.mjs';

const directory = path.resolve(process.argv[2]);
const pages = JSON.parse(await readFile(path.join(directory, 'pages.json'), 'utf8'));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hour = v => `${Math.floor(v).toString().padStart(2,'0')}:${Math.round((v%1)*60).toString().padStart(2,'0')}`;
const hours = (entry, day) => entry.allWeek ? '24/7' : entry[day]?.map(([a,b]) => `${hour(a)}–${hour(b)}`).join(', ') || '—';
let body = '';
let markdown = '';
for (const page of pages) {
    const image = (await readFile(path.join(directory, page.image))).toString('base64');
    let rows = '';
    markdown += `\n### צילום ${page.number}\n\n| רחוב | קטע | א׳–ה׳ | ו׳ | שבת |\n|---|---|---|---|---|\n`;
    for (const raw of page.rows) {
        for (const entry of parseRow(raw)) {
            const cells = [entry.street, entry.section, hours(entry,'sun_thu'), hours(entry,'fri'), hours(entry,'sat')];
            rows += `<tr><th scope="row" class="street" data-field="street" dir="rtl">${esc(entry.street)}</th><td class="section" data-field="section" dir="rtl">${esc(entry.section)}</td>${['sun_thu','fri','sat'].map(day => `<td class="time" data-field="${day}"><bdi dir="ltr">${esc(hours(entry,day))}</bdi></td>`).join('')}<td class="original" data-field="sourceHours" dir="rtl">${esc(clean(raw[2]))}</td></tr>`;
            markdown += `| ${cells.map(v => v.replaceAll('|','/')).join(' | ')} |\n`;
        }
    }
    body += `<section id="page-${page.number}"><h2>צילום ${page.number} מתוך ${pages.length}</h2><img alt="טבלת העירייה — עמוד ${page.number}" src="data:image/jpeg;base64,${image}"><h3>הטבלה שנקראה מצילום ${page.number}</h3><div class="scroll"><table dir="rtl"><colgroup><col style="width:12%"><col style="width:26%"><col style="width:16%"><col style="width:16%"><col style="width:10%"><col style="width:20%"></colgroup><thead><tr><th scope="col">שם הרחוב</th><th scope="col">תיאור המקטע</th><th scope="col">שעות פעילות א׳–ה׳</th><th scope="col">שעות פעילות ו׳</th><th scope="col">שעות פעילות שבת</th><th scope="col">נוסח השעות המקורי</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
const html = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>שעות נתיבי תחבורה ציבורית — צילומים וטבלאות</title><style>body{font-family:Arial,sans-serif;max-width:1300px;margin:32px auto;padding:0 20px;background:#f4f7fa;color:#172b40;line-height:1.6}section{background:white;padding:24px;margin:28px 0;border-radius:12px;break-before:page}img{display:block;max-width:100%;height:auto;margin:auto;border:1px solid #ccd6e0}table{direction:rtl;table-layout:fixed;border-collapse:collapse;width:100%;min-width:1100px;font-size:14px}th,td{padding:9px;border:1px solid #ccd6e0;text-align:right;vertical-align:top}th{background:#dfeefa}td.time{direction:ltr;text-align:center;unicode-bidi:isolate;background:#f0f7fd}td.time bdi{display:block;white-space:normal}th.street{background:#fff;color:#172b40;font-weight:bold}td.section,td.original,th.street{direction:rtl;unicode-bidi:isolate;overflow-wrap:anywhere}.scroll{overflow:auto}nav a{display:inline-block;margin:6px;padding:8px 16px;background:#fff;border-radius:6px}h1,h2{color:#006eac}</style><h1>שעות נתיבי תחבורה ציבורית — צילומים וטבלאות</h1><p>מקור: <a href="https://www.tel-aviv.gov.il/Residents/Transportation/Pages/Roads.aspx">אתר עיריית תל אביב–יפו</a>. צילום: 22 בנובמבר 2026. כל צילום מופיע לצד טבלה מפוענחת ונוסח השעות המקורי. 81 שורות מקור, 82 רשומות לאחר פיצול לפי כיוון.</p><p>— מציין שלא מופיעות שעות פעילות לאותו יום במקור. התמרור בשטח הוא המחייב.</p><nav>${pages.map(p=>`<a href="#page-${p.number}">צילום ${p.number}</a>`).join('')}</nav>${body}</html>`;
await writeFile(path.join(directory, 'municipality-hours-review.html'), html);
await writeFile(path.join(directory, 'tables.md'), markdown);
console.log('Created report with embedded screenshots and grouped tables.');
