// Fail closed: unfamiliar day/time syntax must never silently open a lane.
export const clean = value => value.replace(/[\u200b-\u200f\ufeff]/g, '').replace(/[׳’]/g, "'").replace(/[–—־]/g, '-').replace(/\s+/g, ' ').trim();

function ranges(text) {
    const residue = text.replace(/\d{1,2}:\d{1,2}/g, '').replace(/ולרכב שמשקלו הכולל מעל 12 טון לאתר הבנייה מגדלי הארבעה/g, '').replace(/וערבי חג|ערבי חג|משעה|בשעות|שעה|עד|ומ|מ|ו/g, '').replace(/[\s,.:/\-]/g, '');
    if (residue) throw Error(`Unrecognized time text: ${text}`);
    const found = [...text.matchAll(/(\d{1,2}):(\d{1,2})\s*(?:עד\s*(?:שעה\s*)?|-\s*)(\d{1,2}):(\d{1,2})/g)];
    if (!found.length || (text.match(/\d{1,2}:\d{1,2}/g) || []).length !== found.length * 2) throw Error(`Unrecognized hours: ${text}`);
    return found.map(m => {
        const a = Number(m[1]) + Number(m[2]) / 60;
        const b = Number(m[3]) + Number(m[4]) / 60;
        if (Number(m[2]) > 59 || Number(m[4]) > 59 || a > 24 || b > 24 || a === b) throw Error(`Invalid range: ${m[0]}`);
        // Municipality sometimes displays a hyphenated range in RTL order.
        if (a > b && m[0].includes('עד')) throw Error(`Ambiguous overnight range: ${m[0]}`);
        return [Math.min(a, b), Math.max(a, b)];
    });
}

export function parseRow(cells) {
    if (cells.length !== 4) throw Error('Expected four table columns');
    const [street, section, rawHours] = cells.map(clean);
    if (!street || !section || !rawHours || /[?�]/.test(street + section)) throw Error('Empty or corrupted row');
    const base = { street, section, sourceHours: rawHours };
    if (/^(?:כל ימות השבוע[, ]*)?ב?כל שעות היממה$/.test(rawHours)) return [{ ...base, allWeek: true }];
    const markers = [...rawHours.matchAll(/(?:ב?ימים?|ב?ימי|ב?יום)\s*(?:א'?(?:\s*-\s*|\s+עד\s+)[הו]'?|ו'|שישי|שבת)/g)];
    if (!markers.length || rawHours.slice(0, markers[0].index).trim()) throw Error(`Unknown days: ${rawHours}`);
    const result = { sun_thu: null, fri: null, sat: null };
    const directional = /לכיוון/.test(rawHours);
    const directions = new Map();
    for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        const body = rawHours.slice(marker.index + marker[0].length, markers[i + 1]?.index).replace(/[,.\s]*ו?$/, '');
        const days = /א/.test(marker[0]) ? (/ו/.test(marker[0]) ? ['sun_thu', 'fri'] : ['sun_thu']) : /שבת/.test(marker[0]) ? ['sat'] : ['fri'];
        const parts = directional ? [...body.matchAll(/לכיוון\s+(מערב|מזרח|צפון|דרום)(.*?)(?=לכיוון|$)/g)] : [null];
        if (directional && (!parts.length || body.slice(0, parts[0].index).replace(/[:\s]/g, ''))) throw Error('Unrecognized direction');
        for (const part of parts) {
            const target = directional ? (directions.get(part[1]) || { sun_thu: null, fri: null, sat: null }) : result;
            const value = ranges(part ? part[2] : body);
            for (const day of days) {
                if (target[day]) throw Error(`Duplicate day: ${rawHours}`);
                target[day] = value;
            }
            if (part) directions.set(part[1], target);
        }
    }
    if (directional) return [...directions].map(([direction, hours]) => ({ ...base, section: `${section}; לכיוון ${direction}`, sourceDirection: { 'מערב': 'W', 'מזרח': 'E', 'צפון': 'N', 'דרום': 'S' }[direction], ...hours }));
    return [{ ...base, ...result }];
}

export function validatePages(pages, total) {
    if (!Number.isInteger(total) || total < 1 || pages.length !== total) throw Error('Missing pages');
    const signatures = new Set();
    const entries = [];
    for (let i = 0; i < total; i++) {
        const page = pages[i];
        if (page.number !== i + 1 || !page.rows.length || !page.screenshotValid) throw Error(`Incomplete page ${i + 1}`);
        const signature = JSON.stringify(page.rows);
        if (signatures.has(signature)) throw Error('Repeated page');
        signatures.add(signature);
        entries.push(...page.rows.flatMap(parseRow).map(entry => ({ ...entry, sourcePage: page.number })));
    }
    return entries;
}
