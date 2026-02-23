// ============================================================
// Tel Aviv Public Transportation Lanes - Live Map Application
// Data source: Tel Aviv Municipality GIS - ArcGIS REST API
// Layer 611: נתיבי תחבורה ציבורית (Public Transportation Lanes)
// ============================================================

// ------ Configuration ------
const CONFIG = {
    // ArcGIS REST API endpoint for bus lanes layer 611
    arcgisBaseUrl: 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/611',
    // ArcGIS REST API endpoint for bus lane cameras layer 949
    camerasBaseUrl: 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/949',
    // Query to get all features in WGS84 (EPSG:4326) for Leaflet
    queryParams: {
        where: '1=1',
        outFields: '*',
        outSR: '4326',
        f: 'json',
        resultRecordCount: 2000,
        resultOffset: 0
    },
    // Map initial view - centered on Tel Aviv
    mapCenter: [32.0853, 34.7818],
    mapZoom: 14,
    // Line display weights
    lineWeight: 6,
    lineWeightHover: 9,
    // How often to re-check time status (ms)
    refreshInterval: 60000, // every 1 minute
};

// ------ Hebrew day names ------
const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HEBREW_DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

// ------ State ------
let map;
let allFeatures = [];
let allRawFeatures = [];  // original unsplit features
let allCameras = [];
let allJunctions = [];    // signalized junctions from layer 547
let laneLayerGroup;
let cameraLayerGroup;
let currentDayType = null; // 'sun_thurs', 'fri', 'sat'
let currentHour = null;

// ============================================================
// Time & Day Classification
// ============================================================

/**
 * Determines the current "day type" for schedule lookup.
 * Israeli week:
 *   Sunday (0) - Thursday (4) → 'sun_thurs'
 *   Friday (5) → 'fri' (and eves of holidays)
 *   Saturday (6) → 'sat' (and legal holidays)
 */
function getDayType(date) {
    const day = date.getDay();
    if (day >= 0 && day <= 4) return 'sun_thurs';
    if (day === 5) return 'fri';
    if (day === 6) return 'sat';
    return 'sun_thurs';
}

/**
 * Get the current hour as a decimal (e.g., 14:30 → 14.5)
 */
function getCurrentDecimalHour(date) {
    return date.getHours() + date.getMinutes() / 60;
}

// ============================================================
// Schedule Matching - match GIS features to bus_lane_hours.js
// ============================================================

/**
 * Normalize a Hebrew street name for comparison.
 * Removes quotes, double-quotes, geresh, common prefixes, extra spaces.
 * Also strips first-name suffixes (e.g. "בגין מנחם" → "בגין").
 */
function normalizeStreet(name) {
    if (!name) return '';
    let n = name.trim();
    // Remove common prefixes: רחוב, שדרות, דרך, טיילת, שד׳, רח׳
    n = n.replace(/^(רחוב|רח['׳]?|שדרות|שד['׳]?|דרך|טיילת)\s+/g, '');
    // Remove quotes and special chars
    n = n.replace(/["'׳`]/g, '');
    // Collapse whitespace
    n = n.replace(/\s+/g, ' ').trim();
    return n;
}

/**
 * Map of GIS street names → schedule street names for cases where
 * the naming convention differs (GIS uses "LastName FirstName" format,
 * schedule uses street signs / short names).
 */
const STREET_ALIASES = {
    // GIS "LastName FirstName" → Schedule short name
    'בגין מנחם': 'בגין',
    'נמיר מרדכי': 'נמיר',
    'לבון פנחס': 'לבון',
    'סנה משה': 'משה סנה',
    'קפלן אליעזר': 'קפלן',
    'אלון יגאל': 'יגאל אלון',
    'אלחנן יצחק': 'יצחק אלחנן',
    // Spelling differences
    'תל גבורים': 'תל גיבורים',
    // GIS uses העליה, schedule uses היינה (same street)
    'העליה': 'היינה',
    // GIS "הרברט סמואל" → schedule "טיילת הרברט סמואל" (already normalized)
    'הרברט סמואל': 'הרברט סמואל',
    // GIS "המלך גורג" (after normalize removes quotes)
    'המלך גורג': 'המלך גורג',
    // Additional possible mappings
    'גבעת התחמושת': 'קפלן', // Part of Kaplan junction
};

/**
 * Score how well a schedule entry matches a GIS feature.
 * Higher = better match. Returns 0 if no match.
 */
function matchScore(entry, feature) {
    const attrs = feature.attributes;
    const featureStreet = normalizeStreet(attrs.street_name);
    const entryStreet = normalizeStreet(entry.street);

    if (!featureStreet || !entryStreet) return 0;

    // Street name must match (directly or via alias)
    const aliased = STREET_ALIASES[featureStreet] || featureStreet;
    const match = (featureStreet === entryStreet) || (aliased === entryStreet);
    // Also check if one contains the other (for partial matches like "נמיר" in "דרך נמיר")
    const partialMatch = !match && (entryStreet.includes(featureStreet) || featureStreet.includes(entryStreet));

    if (!match && !partialMatch) return 0;

    let score = match ? 1 : 0.3; // partial matches get lower base score

    // Try to match section details using from_street, to_street, direction
    const section = entry.section || '';
    const fromStreet = normalizeStreet(attrs.from_street);
    const toStreet = normalizeStreet(attrs.to_street);
    const direction = attrs.direction_name || '';

    // Check if section mentions from/to streets
    if (fromStreet && section.includes(fromStreet)) score += 3;
    if (toStreet && section.includes(toStreet)) score += 3;

    // Check direction match
    if (direction === 'N' && (section.includes('לצפון') || section.includes('צפונה'))) score += 2;
    if (direction === 'S' && (section.includes('לדרום') || section.includes('דרומה'))) score += 2;
    if (direction === 'E' && (section.includes('למזרח') || section.includes('מזרחה'))) score += 2;
    if (direction === 'W' && (section.includes('למערב') || section.includes('מערבה'))) score += 2;

    // If entry is 'default', it's a fallback - lower score
    if (section === 'default') score = Math.min(score, 0.5);

    return score;
}

/**
 * Find the best schedule entry for a GIS feature.
 * Uses SCHEDULE_BY_STREET index from bus_lane_hours.js.
 * Handles GIS ↔ schedule naming differences via aliases and partial matching.
 */
function findSchedule(feature) {
    if (typeof SCHEDULE_BY_STREET === 'undefined') return null;

    const rawStreet = normalizeStreet(feature.attributes.street_name);
    if (!rawStreet) return null;

    // Try multiple name variants
    const aliased = STREET_ALIASES[rawStreet] || rawStreet;
    const variants = new Set([rawStreet, aliased]);

    // Collect all candidates from all variants
    let candidates = [];
    for (const key of Object.keys(SCHEDULE_BY_STREET)) {
        const normKey = normalizeStreet(key);
        for (const variant of variants) {
            if (normKey === variant || normKey.includes(variant) || variant.includes(normKey)) {
                candidates = candidates.concat(SCHEDULE_BY_STREET[key]);
            }
        }
    }

    // Deduplicate
    candidates = [...new Set(candidates)];

    if (candidates.length === 0) return null;

    // If only one candidate, use it
    if (candidates.length === 1) return candidates[0];

    // Score each candidate and pick the best
    let best = null;
    let bestScore = 0;
    for (const entry of candidates) {
        const s = matchScore(entry, feature);
        if (s > bestScore) {
            bestScore = s;
            best = entry;
        }
    }

    // If no good match found but we have candidates, use the first one as fallback
    return best || candidates[0];
}

/**
 * Determines if a bus lane is currently BLOCKED for private vehicles.
 * 
 * Uses schedule data from bus_lane_hours.js (sourced from Tel Aviv municipality website).
 * Falls back to GIS feature attributes if no schedule match found.
 * 
 * Logic:
 * - allWeek: true → ALWAYS blocked (permanent 24/7 bus lane)
 * - Has time ranges → blocked during those hours for the current day type
 * - No schedule match → unknown (gray)
 * 
 * Returns: { blocked: boolean, reason: string, category: string, schedule: object|null }
 */
function getLaneStatus(feature, now) {
    const attrs = feature.attributes;
    const dayType = getDayType(now);
    const currentHr = getCurrentDecimalHour(now);
    const status = attrs.status;

    // If lane is not active, it's open
    if (status && status !== 'פעיל') {
        return { blocked: false, reason: 'נתצ לא פעיל', category: 'open', schedule: null, signOverride: null };
    }

    // Check for community sign override first
    const signOvr = typeof getSignOverride === 'function' ? getSignOverride(feature) : null;
    if (signOvr && signOvr.hours) {
        const ovr = signOvr.hours;
        if (ovr.allWeek) {
            return { blocked: true, reason: 'נתצ קבוע – חסום תמיד (24/7) 🪧', category: 'blocked', schedule: ovr, signOverride: signOvr };
        }
        let ranges = null;
        if (dayType === 'sun_thurs') ranges = ovr.sun_thu;
        else if (dayType === 'fri') ranges = ovr.fri;
        else if (dayType === 'sat') ranges = ovr.sat;
        if (!ranges || ranges.length === 0) {
            return { blocked: false, reason: `אין הגבלה ביום ${HEBREW_DAYS[now.getDay()]} 🪧`, category: 'open', schedule: ovr, signOverride: signOvr };
        }
        for (const [start, end] of ranges) {
            if (isInTimeRange(currentHr, start, end)) {
                return { blocked: true, reason: `חסום כעת: ${formatHour(start)} - ${formatHour(end)} 🪧`, category: 'blocked', schedule: ovr, signOverride: signOvr };
            }
        }
        const rangeStr = ranges.map(r => `${formatHour(r[0])}-${formatHour(r[1])}`).join(', ');
        return { blocked: false, reason: `פתוח כעת (הגבלה: ${rangeStr}) 🪧`, category: 'open', schedule: ovr, signOverride: signOvr };
    }

    // Find schedule from bus_lane_hours.js
    const schedule = findSchedule(feature);

    if (!schedule) {
        // No schedule data found for this feature → unknown
        return { blocked: true, reason: 'לא נמצא מידע על שעות – ייתכן שחסום', category: 'unknown', schedule: null, signOverride: null };
    }

    // 24/7 permanent bus lane
    if (schedule.allWeek) {
        return { blocked: true, reason: 'נתצ קבוע – חסום תמיד (24/7)', category: 'blocked', schedule, signOverride: null };
    }

    // Get time ranges for current day type
    let ranges = null;
    if (dayType === 'sun_thurs') {
        ranges = schedule.sun_thu;
    } else if (dayType === 'fri') {
        ranges = schedule.fri;
    } else if (dayType === 'sat') {
        ranges = schedule.sat;
    }

    // No restriction for this day type → open
    if (!ranges || ranges.length === 0) {
        return {
            blocked: false,
            reason: `אין הגבלה ביום ${HEBREW_DAYS[now.getDay()]}`,
            category: 'open',
            schedule,
            signOverride: null
        };
    }

    // Check each time range
    for (const [start, end] of ranges) {
        if (isInTimeRange(currentHr, start, end)) {
            return {
                blocked: true,
                reason: `חסום כעת: ${formatHour(start)} - ${formatHour(end)}`,
                category: 'blocked',
                schedule,
                signOverride: null
            };
        }
    }

    // Outside all operating hours → open
    const rangeStr = ranges.map(r => `${formatHour(r[0])}-${formatHour(r[1])}`).join(', ');
    return {
        blocked: false,
        reason: `פתוח כעת (הגבלה: ${rangeStr})`,
        category: 'open',
        schedule,
        signOverride: null
    };
}

function isInTimeRange(current, start, end) {
    if (start <= end) {
        return current >= start && current < end;
    } else {
        // Overnight range (e.g., 22:00 - 06:00)
        return current >= start || current < end;
    }
}

function formatHour(decimal) {
    if (decimal === null || decimal === undefined) return '--:--';
    const hours = Math.floor(decimal);
    const minutes = Math.round((decimal - hours) * 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// ============================================================
// Data Fetching
// ============================================================

/**
 * Fetch all bus lane features from the ArcGIS REST API.
 * Handles pagination (max 2000 per request).
 */
async function fetchAllFeatures() {
    let allFeatures = [];
    let offset = 0;
    const batchSize = 2000;
    let hasMore = true;

    while (hasMore) {
        const params = new URLSearchParams({
            ...CONFIG.queryParams,
            resultOffset: offset,
            resultRecordCount: batchSize
        });

        const url = `${CONFIG.arcgisBaseUrl}/query?${params}`;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || 'ArcGIS API error');
            }

            if (data.features && data.features.length > 0) {
                allFeatures = allFeatures.concat(data.features);
                offset += data.features.length;
                // If exceededTransferLimit is true, there are more features
                hasMore = data.exceededTransferLimit === true;
            } else {
                hasMore = false;
            }
        } catch (error) {
            console.error('Error fetching features:', error);
            hasMore = false;
        }
    }

    console.log(`Fetched ${allFeatures.length} bus lane features from Tel Aviv GIS`);
    return allFeatures;
}

/**
 * Fetch all camera features from Layer 949.
 */
async function fetchAllCameras() {
    let cameras = [];
    let offset = 0;
    const batchSize = 2000;
    let hasMore = true;

    while (hasMore) {
        const params = new URLSearchParams({
            where: '1=1',
            outFields: '*',
            outSR: '4326',
            f: 'json',
            resultOffset: offset,
            resultRecordCount: batchSize
        });

        const url = `${CONFIG.camerasBaseUrl}/query?${params}`;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || 'ArcGIS API error');
            }

            if (data.features && data.features.length > 0) {
                cameras = cameras.concat(data.features);
                offset += data.features.length;
                hasMore = data.exceededTransferLimit === true;
            } else {
                hasMore = false;
            }
        } catch (error) {
            console.error('Error fetching cameras:', error);
            hasMore = false;
        }
    }

    console.log(`Fetched ${cameras.length} camera features from Tel Aviv GIS`);
    return cameras;
}

// ============================================================
// Map Rendering
// ============================================================

function initMap() {
    map = L.map('map', {
        center: CONFIG.mapCenter,
        zoom: CONFIG.mapZoom,
        zoomControl: false
    });

    // Add zoom control on the left side (since RTL)
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Base tile layer - CartoDB Positron (light gray, no colorful roads)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a> | נתונים: עיריית תל אביב-יפו',
        maxZoom: 20,
        subdomains: 'abcd'
    }).addTo(map);

    laneLayerGroup = L.layerGroup().addTo(map);
    cameraLayerGroup = L.layerGroup().addTo(map);
}

/**
 * Convert ArcGIS polyline paths to Leaflet LatLng arrays.
 * ArcGIS returns [lng, lat], Leaflet expects [lat, lng].
 */
function arcgisPathsToLatLngs(paths) {
    return paths.map(path =>
        path.map(coord => [coord[1], coord[0]])
    );
}

/**
 * Get color based on lane status
 */
function getStatusColor(status) {
    if (status.category === 'unknown') return '#95a5a6'; // gray for no schedule data
    if (status.blocked) return '#e74c3c'; // red - blocked
    return '#2ecc71'; // green - open
}

/**
 * Create popup HTML for a lane feature
 */
function createPopupContent(feature, status) {
    const a = feature.attributes;
    const directionText = a.direction_name ?
        (a.direction_name === 'E' ? 'מזרח' :
         a.direction_name === 'W' ? 'מערב' :
         a.direction_name === 'N' ? 'צפון' :
         a.direction_name === 'S' ? 'דרום' :
         a.direction_name) : 'לא צוין';

    const typeText = a.type_of_nataz || 'לא צוין';
    const statusClass = status.blocked ? 'blocked' : 'open';
    const statusText = status.blocked ? '🚫 חסום לרכב פרטי' : '✅ פתוח לרכב פרטי';

    let hoursHtml = '';
    const sch = status.schedule;

    if (sch) {
        if (sch.allWeek) {
            hoursHtml = '<div class="popup-row"><span class="popup-label">שעות הגבלה:</span><span class="popup-value">כל ימות השבוע, כל שעות היממה (24/7)</span></div>';
        } else {
            // Sun-Thu hours
            if (sch.sun_thu && sch.sun_thu.length > 0) {
                const rangeStr = sch.sun_thu.map(r => `${formatHour(r[0])} - ${formatHour(r[1])}`).join(' , ');
                hoursHtml += `<div class="popup-row">
                    <span class="popup-label">א׳-ה׳:</span>
                    <span class="popup-value">${rangeStr}</span>
                </div>`;
            }

            // Friday hours
            if (sch.fri && sch.fri.length > 0) {
                const rangeStr = sch.fri.map(r => `${formatHour(r[0])} - ${formatHour(r[1])}`).join(' , ');
                hoursHtml += `<div class="popup-row">
                    <span class="popup-label">ו׳ / ערבי חג:</span>
                    <span class="popup-value">${rangeStr}</span>
                </div>`;
            }

            // Saturday hours
            if (sch.sat && sch.sat.length > 0) {
                const rangeStr = sch.sat.map(r => `${formatHour(r[0])} - ${formatHour(r[1])}`).join(' , ');
                hoursHtml += `<div class="popup-row">
                    <span class="popup-label">שבת / חג:</span>
                    <span class="popup-value">${rangeStr}</span>
                </div>`;
            }

            if (!hoursHtml) {
                hoursHtml = '<div class="popup-row"><span class="popup-label">שעות הגבלה:</span><span class="popup-value">לא נמצא מידע</span></div>';
            }
        }

        // Show matched section info
        if (sch.section && sch.section !== 'default') {
            hoursHtml += `<div class="popup-row" style="font-size: 11px; color: #888;">
                <span class="popup-label">קטע מתואם:</span>
                <span class="popup-value">${sch.section}</span>
            </div>`;
        }
    } else {
        hoursHtml = '<div class="popup-row"><span class="popup-label">שעות הגבלה:</span><span class="popup-value" style="color:#e67e22;">לא נמצא מידע (לא בטבלת העירייה)</span></div>';
    }

    // Sign verification badge
    let signBadgeHtml = '';
    const streetReports = typeof getReportsForStreet === 'function' ? getReportsForStreet(a.street_name) : [];
    if (status.signOverride) {
        const ovrDate = new Date(status.signOverride.timestamp).toLocaleDateString('he-IL');
        signBadgeHtml = `<div class="sign-badge verified">
            <span class="badge-icon">🪧✅</span>
            <span>עודכן לפי שלט בשטח — ${ovrDate}</span>
        </div>`;
    } else if (streetReports.length > 0) {
        const pending = streetReports.filter(r => r.status === 'pending').length;
        if (pending > 0) {
            signBadgeHtml = `<div class="sign-badge not-verified">
                <span class="badge-icon">🪧⏳</span>
                <span>${pending} דיווח(ים) ממתינים לפענוח</span>
            </div>`;
        } else {
            signBadgeHtml = `<div class="sign-badge not-verified">
                <span class="badge-icon">🪧</span>
                <span>לא אומת מול שלט בשטח</span>
            </div>`;
        }
    } else {
        signBadgeHtml = `<div class="sign-badge not-verified">
            <span class="badge-icon">🪧</span>
            <span>לא אומת מול שלט בשטח</span>
        </div>`;
    }

    const featureId = a.OBJECTID || a.objectid || '';

    return `
        <div class="lane-popup">
            <h3>🚌 ${a.street_name || 'ללא שם'}</h3>
            <div class="popup-row">
                <span class="popup-label">קטע:</span>
                <span class="popup-value">${a.from_street || '?'} → ${a.to_street || '?'}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">כיוון:</span>
                <span class="popup-value">${directionText}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">סוג:</span>
                <span class="popup-value">${typeText}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">נתיבי נתצ:</span>
                <span class="popup-value">${a.number_public_transportation_l || '?'}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">נתיבי רכב פרטי:</span>
                <span class="popup-value">${a.number_private_lanes || '?'}</span>
            </div>
            <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
            <div style="font-weight: 600; margin-bottom: 4px;">שעות הגבלה:</div>
            ${hoursHtml}
            ${a.comments ? `<div class="popup-row"><span class="popup-label">הערות:</span><span class="popup-value">${a.comments}</span></div>` : ''}
            <div style="text-align: center;">
                <span class="popup-status ${statusClass}">${statusText}</span>
            </div>
            <div style="font-size: 10px; color: #999; margin-top: 6px; text-align: center;">${status.reason}</div>
            ${signBadgeHtml}
            <button class="popup-report-btn" onclick="openPhotoModalForStreet('${(a.street_name || '').replace(/'/g, "\\'")}')">🪧 דווח שלט מהשטח</button>
        </div>
    `;
}

/**
 * Render all lanes on the map with current time-based coloring
 */
function renderLanes(features, now) {
    laneLayerGroup.clearLayers();

    let blockedCount = 0;
    let openCount = 0;
    let permanentCount = 0;

    features.forEach(feature => {
        if (!feature.geometry || !feature.geometry.paths) return;

        const status = getLaneStatus(feature, now);
        const color = getStatusColor(status);
        const latLngs = arcgisPathsToLatLngs(feature.geometry.paths);

        if (status.category === 'unknown') permanentCount++;
        else if (status.blocked) blockedCount++;
        else openCount++;

        latLngs.forEach(path => {
            const polyline = L.polyline(path, {
                color: color,
                weight: CONFIG.lineWeight,
                opacity: 0.85,
                lineJoin: 'round',
                lineCap: 'round'
            });

            polyline.on('mouseover', function () {
                this.setStyle({ weight: CONFIG.lineWeightHover, opacity: 1 });
                this.bringToFront();
            });

            polyline.on('mouseout', function () {
                this.setStyle({ weight: CONFIG.lineWeight, opacity: 0.85 });
            });

            // Don't bind popups during sim planning (they intercept clicks)
            if (!(simActive && simPlanning)) {
                polyline.bindPopup(createPopupContent(feature, status), {
                    maxWidth: 320,
                    className: 'lane-popup-container'
                });
            }

            laneLayerGroup.addLayer(polyline);
        });

        // Add direction arrow(s) on each segment — use traffic order
        const trafficPts = getFeaturePointsInTrafficOrder(feature);
        if (trafficPts.length >= 2) {
            let totalLen = 0;
            for (let k = 1; k < trafficPts.length; k++) {
                totalLen += L.latLng(trafficPts[k - 1]).distanceTo(L.latLng(trafficPts[k]));
            }
            const numArrows = Math.max(1, Math.round(totalLen / 120));
            for (let a = 0; a < numArrows; a++) {
                const frac = (a + 0.5) / numArrows;
                const ptIdx = Math.min(Math.floor(frac * trafficPts.length), trafficPts.length - 1);
                const prevIdx = Math.max(0, ptIdx - 1);
                const nextIdx = Math.min(trafficPts.length - 1, ptIdx + 1);
                const localBearing = bearingBetween(
                    trafficPts[prevIdx][0], trafficPts[prevIdx][1],
                    trafficPts[nextIdx][0], trafficPts[nextIdx][1]
                );
                const arrowIcon = L.divIcon({
                    className: 'lane-arrow-icon',
                    html: `<div style="transform:rotate(${localBearing - 90}deg)">▶</div>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                });
                L.marker(trafficPts[ptIdx], { icon: arrowIcon, interactive: false }).addTo(laneLayerGroup);
            }
        }
    });

    // Update counters
    document.getElementById('blockedCount').textContent = blockedCount;
    document.getElementById('openCount').textContent = openCount;
    document.getElementById('unknownCount').textContent = permanentCount;
}

// ============================================================
// Camera Rendering
// ============================================================

/**
 * Create a camera icon for the map marker
 */
function createCameraIcon() {
    return L.divIcon({
        className: 'camera-marker',
        html: '<div class="camera-icon-inner">📷</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
    });
}

/**
 * Create popup HTML for a camera feature
 */
function createCameraPopupContent(feature) {
    const a = feature.attributes;
    const statusText = a.status === 'פעיל' ? '🟢 פעילה' : '🔴 לא פעילה';

    // Translate sug (pole type)
    const sugMap = {
        'עמוד חדש': 'עמוד חדש',
        'עמוד רמזורים': 'עמוד רמזורים',
        'עמוד מאור': 'עמוד מאור',
        'עמוד משולב ': 'עמוד משולב',
        'עמוד תמרור': 'עמוד תמרור',
        'עמוד מאור טעינת לילה': 'עמוד מאור (טעינת לילה)',
        'סלולארי': 'סלולרי'
    };
    const sugText = sugMap[a.sug] || a.sug || 'לא צוין';

    // Segment assignment info from precomputed index
    const mapping = cameraSegmentMap[a.OBJECTID];
    let segmentInfo = '';
    if (mapping && mapping.segments.length > 0) {
        const segDescs = mapping.segments.map(seg => {
            const sa = seg.attributes;
            const dirMap = { N: '↑צפון', NE: '↗צפ-מזרח', E: '→מזרח', SE: '↘דרום-מזרח', S: '↓דרום', SW: '↙דרום-מערב', W: '←מערב', NW: '↖צפ-מערב' };
            const dirText = dirMap[sa.direction_name] || 'דו-כיווני';
            const from = sa.from_street || '?';
            const to = sa.to_street || '?';
            return `${from} → ${to} (${dirText})`;
        }).join('<br>');

        const badge = mapping.bidirectional
            ? '<span style="background:#f39c12;color:#fff;padding:2px 6px;border-radius:8px;font-size:11px;">↔ דו-כיוונית</span>'
            : '<span style="background:#27ae60;color:#fff;padding:2px 6px;border-radius:8px;font-size:11px;">✓ מסווגת</span>';

        segmentInfo = `
            <div class="popup-row">
                <span class="popup-label">מקטע נת"צ:</span>
                <span class="popup-value">${badge}<br><span style="font-size:12px;">${segDescs}</span></span>
            </div>`;
    } else {
        segmentInfo = `
            <div class="popup-row">
                <span class="popup-label">מקטע נת"צ:</span>
                <span class="popup-value"><span style="color:#999;font-size:12px;">לא שויכה לנתיב</span></span>
            </div>`;
    }

    // Report button for bidirectional cameras
    const reportBtn = (mapping && mapping.bidirectional)
        ? `<button class="popup-report-btn" onclick="openCameraReportModal(${a.OBJECTID})">📷 דווח כיוון מצלמה</button>`
        : '';

    return `
        <div class="lane-popup">
            <h3>📷 מצלמת נת"צ</h3>
            <div class="popup-row">
                <span class="popup-label">שם:</span>
                <span class="popup-value">${a.name || 'לא צוין'}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">רחוב:</span>
                <span class="popup-value">${a.t_rechov1 || 'לא צוין'} ${a.ms_bayit1 || ''}</span>
            </div>
            ${a.heara && a.heara.trim() ? `<div class="popup-row">
                <span class="popup-label">הערה:</span>
                <span class="popup-value">${a.heara.trim()}</span>
            </div>` : ''}
            <div class="popup-row">
                <span class="popup-label">סוג התקנה:</span>
                <span class="popup-value">${sugText}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">מס׳ אתר:</span>
                <span class="popup-value">${a.ms_atar || '?'}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">סטטוס:</span>
                <span class="popup-value">${statusText}</span>
            </div>
            ${segmentInfo}
            ${reportBtn}
        </div>
    `;
}

/**
 * Render camera markers on the map
 */
function renderCameras(cameras) {
    cameraLayerGroup.clearLayers();
    const icon = createCameraIcon();

    let activeCount = 0;
    cameras.forEach(feature => {
        const g = feature.geometry;
        if (!g || g.x === undefined || g.y === undefined) return;

        const a = feature.attributes;
        if (a.status === 'פעיל') activeCount++;

        const marker = L.marker([g.y, g.x], { icon: icon });

        marker.bindPopup(createCameraPopupContent(feature), {
            maxWidth: 300,
            className: 'lane-popup-container'
        });

        cameraLayerGroup.addLayer(marker);
    });

    // Update camera counter
    const el = document.getElementById('cameraCount');
    if (el) el.textContent = activeCount;

    console.log(`Rendered ${cameras.length} cameras (${activeCount} active)`);
}

// ============================================================
// Clock & Time Updates
// ============================================================

function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('he-IL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const dayStr = `יום ${HEBREW_DAYS[now.getDay()]}`;

    document.getElementById('clockTime').textContent = timeStr;
    document.getElementById('clockDay').textContent = dayStr;
}

function startClockUpdates() {
    updateClock();
    setInterval(updateClock, 1000);
}

/**
 * Periodically re-evaluate lane statuses
 * (in case the time crosses an operating hour boundary)
 */
function startStatusRefresh() {
    setInterval(() => {
        if (allFeatures.length > 0) {
            renderLanes(allFeatures, new Date());
        }
    }, CONFIG.refreshInterval);
}

// ============================================================
// Camera Toggle
// ============================================================

function setupCameraToggle() {
    const checkbox = document.getElementById('toggleCameras');
    if (checkbox) {
        checkbox.addEventListener('change', function () {
            if (this.checked) {
                map.addLayer(cameraLayerGroup);
            } else {
                map.removeLayer(cameraLayerGroup);
            }
        });
    }
}

// ============================================================
// Camera → Segment Offline Mapping
// ============================================================

/**
 * Precomputed map: camera OBJECTID → { segments: [feature, …], bidirectional: bool }
 * Built once after both bus lanes and cameras are loaded.
 */
let cameraSegmentMap = {};  // camOBJECTID → { segments: [feature…], bidirectional: bool }

/**
 * Build offline index mapping each camera to its bus-lane segment(s).
 *
 * Algorithm per camera:
 *  1. Match camera street (t_rechov1) to bus-lane street_name
 *     (using normalizeStreet + STREET_ALIASES).
 *  2. Find all segments of that street within 60 m of the camera.
 *  3a. If only one-way segments found → assign to the closest one.
 *  3b. If two opposing-direction segments found AND camera has a
 *      house number (ms_bayit1) → pick the side whose polyline is
 *      closer to the "house-number side" of the street
 *      (even → left side of ascending direction, odd → right side).
 *  3c. If no house number AND the two segments are < 10 m apart at
 *      the camera location → assign camera to BOTH (bidirectional).
 *  4. Cameras with no street match are left unmapped.
 */
function buildCameraSegmentIndex() {
    cameraSegmentMap = {};
    if (allFeatures.length === 0 || allCameras.length === 0) return;

    // Pre-group bus-lane features by normalised street name
    const lanesByStreet = {};
    for (const f of allFeatures) {
        const sn = f.attributes.street_name;
        if (!sn) continue;
        const norm = normalizeStreet(sn);
        const aliased = STREET_ALIASES[norm] || norm;
        lanesByStreet[norm] = lanesByStreet[norm] || [];
        lanesByStreet[norm].push(f);
        if (aliased !== norm) {
            lanesByStreet[aliased] = lanesByStreet[aliased] || [];
            lanesByStreet[aliased].push(f);
        }
    }

    const CAM_SNAP_RADIUS = 60;  // metres

    for (const cam of allCameras) {
        const a = cam.attributes;
        const g = cam.geometry;
        if (!g || g.x === undefined || g.y === undefined) continue;

        const camPos = L.latLng(g.y, g.x);
        const camStreet = normalizeStreet(a.t_rechov1 || '');
        if (!camStreet) continue;

        // Find matching bus-lane street (direct or via alias)
        const aliased = STREET_ALIASES[camStreet] || camStreet;
        let candidates = lanesByStreet[camStreet] || lanesByStreet[aliased] || [];

        // Also try reverse alias lookup
        if (candidates.length === 0) {
            for (const [gisName, schedName] of Object.entries(STREET_ALIASES)) {
                if (schedName === camStreet || schedName === aliased) {
                    candidates = lanesByStreet[gisName] || [];
                    if (candidates.length > 0) break;
                }
            }
        }

        if (candidates.length === 0) continue;

        // Find segments within snap radius, sorted by distance
        const nearby = [];
        for (const f of candidates) {
            if (!f.geometry || !f.geometry.paths) continue;
            const dist = distanceToPolyline(camPos, f.geometry.paths);
            if (dist < CAM_SNAP_RADIUS) {
                nearby.push({ feature: f, dist });
            }
        }
        if (nearby.length === 0) continue;
        nearby.sort((a, b) => a.dist - b.dist);

        // Classify: how many distinct directions?
        const dirGroups = {};  // direction → [{ feature, dist }]
        for (const n of nearby) {
            const dir = n.feature.attributes.direction_name || 'none';
            dirGroups[dir] = dirGroups[dir] || [];
            dirGroups[dir].push(n);
        }
        const distinctDirs = Object.keys(dirGroups).filter(d => d !== 'none');

        let assignedSegments = [];
        let bidirectional = false;

        if (nearby.length === 1 || distinctDirs.length <= 1) {
            // Single segment or all same direction → assign closest
            assignedSegments = [nearby[0].feature];
        } else if (distinctDirs.length >= 2) {
            // Two or more opposing directions
            const houseNum = parseInt(a.ms_bayit1);

            if (houseNum > 0) {
                // Use house number to pick side.
                // Concept: for a N-bound segment, even numbers are on the west (left)
                // and odd on the east (right) — or vice-versa depending on the city.
                // We use a geometric approach: offset the camera position slightly
                // perpendicular to each segment and see which is closer.
                const isEven = houseNum % 2 === 0;

                // Pick the two closest segments from different directions
                const seg1 = nearby[0];
                let seg2 = nearby.find(n =>
                    (n.feature.attributes.direction_name || 'none') !==
                    (seg1.feature.attributes.direction_name || 'none')
                );

                if (seg2) {
                    // The camera is physically closer to one side — the house number
                    // tells us which side it's mounted on. Use the closest segment
                    // that matches the camera's physical position.
                    // Simpler heuristic: even house numbers → pick westernmost/southernmost
                    // segment, odd → easternmost/northernmost. But since the camera
                    // position IS on one side, just pick the nearest segment.
                    // The house number mainly confirms the side, so nearest is correct.
                    if (Math.abs(seg1.dist - seg2.dist) < 3) {
                        // Too close to tell — use house number parity
                        // In Tel Aviv convention: even numbers on ascending side
                        const dir1 = seg1.feature.attributes.direction_name || '';
                        const ascendingDirs = ['N', 'NE', 'E'];
                        const isDir1Ascending = ascendingDirs.includes(dir1);
                        if (isEven === isDir1Ascending) {
                            assignedSegments = [seg1.feature];
                        } else {
                            assignedSegments = [seg2.feature];
                        }
                    } else {
                        // Clear distance difference — nearest segment is the correct side
                        assignedSegments = [seg1.feature];
                    }
                } else {
                    assignedSegments = [seg1.feature];
                }
            } else {
                // No house number — check distance between opposing segments
                const seg1 = nearby[0];
                const seg2 = nearby.find(n =>
                    (n.feature.attributes.direction_name || 'none') !==
                    (seg1.feature.attributes.direction_name || 'none')
                );

                if (seg2 && Math.abs(seg1.dist - seg2.dist) < 10) {
                    // Less than 10m apart — assign to both (bidirectional)
                    assignedSegments = [seg1.feature, seg2.feature];
                    bidirectional = true;
                } else {
                    // One is clearly closer
                    assignedSegments = [seg1.feature];
                }
            }
        }

        if (assignedSegments.length > 0) {
            cameraSegmentMap[a.OBJECTID] = {
                segments: assignedSegments,
                bidirectional: bidirectional
            };
        }
    }

    // Log stats
    const mapped = Object.keys(cameraSegmentMap).length;
    const bidir = Object.values(cameraSegmentMap).filter(v => v.bidirectional).length;
    console.log(`📷 Camera-segment index: ${mapped} mapped (${bidir} bidirectional), ${allCameras.length - mapped} unmapped`);
}

// ============================================================
// GPS Tracking, Proximity Detection, Voice Alerts
// ============================================================

// ------ GPS State ------
let gpsWatchId = null;
let gpsActive = false;
let userMarker = null;
let userAccuracyCircle = null;
let userLatLng = null;
let followMode = false; // auto-center on user

// ------ Voice State ------
let voiceEnabled = false;
const ALERT_COOLDOWN_MS = 300000;    // 5 minutes between repeated alerts for same key
let alertCooldowns = {};             // key → timestamp of last alert
let currentSegment = null;           // the feature (segment) the user is currently driving on

// ------ Driving Mode State ------
let drivingMode = false;

// ------ GPS Low-Pass Filter & Heading State ------
const GPS_LP_ALPHA = 0.35;          // EMA smoothing factor (0<α<1, lower = smoother)
const GPS_MIN_SPEED_FOR_HEADING = 1.5;  // m/s (~5.4 km/h) — below this, keep last heading
const GPS_MIN_MOVE_METERS = 3;      // ignore jitter smaller than this
let filteredLat = null;
let filteredLng = null;
let filteredSpeed = 0;               // m/s, smoothed
let filteredBearing = null;          // degrees 0-360, smoothed
let lastFilteredTime = 0;            // timestamp of last accepted filtered position
let prevFilteredLat = null;          // previous filtered position for speed calc
let prevFilteredLng = null;
let currentHeading = null;           // final heading used for car icon

/**
 * Start watching GPS position
 */
function startGps() {
    if (!navigator.geolocation) {
        alert('הדפדפן לא תומך ב-GPS');
        return;
    }

    gpsActive = true;
    followMode = true;
    updateGpsButton();

    gpsWatchId = navigator.geolocation.watchPosition(
        onGpsPosition,
        onGpsError,
        {
            enableHighAccuracy: true,
            maximumAge: 3000,
            timeout: 15000
        }
    );
}

/**
 * Stop watching GPS
 */
function stopGps() {
    if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }
    gpsActive = false;
    followMode = false;
    updateGpsButton();

    // Remove markers
    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    if (userAccuracyCircle) { map.removeLayer(userAccuracyCircle); userAccuracyCircle = null; }
    userLatLng = null;

    // Reset low-pass filter state
    filteredLat = null;
    filteredLng = null;
    filteredSpeed = 0;
    filteredBearing = null;
    lastFilteredTime = 0;
    prevFilteredLat = null;
    prevFilteredLng = null;
    currentHeading = null;
    currentSegment = null;
}

/**
 * Handle GPS position update — applies an EMA low-pass filter to
 * smooth out GPS measurement noise. Only filtered positions are used
 * for the map marker, heading, speed and proximity alerts.
 */
function onGpsPosition(pos) {
    const rawLat = pos.coords.latitude;
    const rawLng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;
    const now = Date.now();

    // --- Low-pass filter (Exponential Moving Average) ---
    if (filteredLat === null) {
        // First reading — initialise filter
        filteredLat = rawLat;
        filteredLng = rawLng;
        lastFilteredTime = now;
    } else {
        // Adaptive alpha: trust accurate readings more
        const alpha = accuracy < 15 ? GPS_LP_ALPHA : GPS_LP_ALPHA * 0.5;
        filteredLat = filteredLat + alpha * (rawLat - filteredLat);
        filteredLng = filteredLng + alpha * (rawLng - filteredLng);
    }

    // --- Filtered position ---
    userLatLng = L.latLng(filteredLat, filteredLng);

    // --- Compute smoothed speed & bearing from filtered positions ---
    updateFilteredSpeedAndBearing(filteredLat, filteredLng, now);

    // --- Heading from filtered bearing (or one-way street) ---
    currentHeading = calculateHeading(userLatLng);

    // --- Update / create user marker ---
    updateUserMarker();

    // --- Update accuracy circle ---
    if (!userAccuracyCircle) {
        userAccuracyCircle = L.circle(userLatLng, {
            radius: accuracy,
            className: 'gps-accuracy',
            weight: 1
        }).addTo(map);
    } else {
        userAccuracyCircle.setLatLng(userLatLng);
        userAccuracyCircle.setRadius(accuracy);
    }

    // --- Auto-follow ---
    if (followMode) {
        map.setView(userLatLng, Math.max(map.getZoom(), 16));
    }

    // --- Proximity alerts ---
    if (voiceEnabled) {
        checkDrivingAlerts(userLatLng);
    }
}

/**
 * Compute smoothed speed (m/s) and bearing (degrees) from the series
 * of filtered lat/lng positions.
 */
function updateFilteredSpeedAndBearing(lat, lng, now) {
    if (prevFilteredLat === null) {
        // First update — just store
        prevFilteredLat = lat;
        prevFilteredLng = lng;
        lastFilteredTime = now;
        return;
    }

    const dtSec = (now - lastFilteredTime) / 1000;
    if (dtSec <= 0) return;

    const dist = L.latLng(prevFilteredLat, prevFilteredLng).distanceTo(L.latLng(lat, lng));

    // Ignore tiny jitter
    if (dist < GPS_MIN_MOVE_METERS) {
        lastFilteredTime = now;
        return;
    }

    // Instantaneous speed from filtered delta
    const instantSpeed = dist / dtSec;
    // Smooth the speed itself with the same EMA
    filteredSpeed = filteredSpeed === 0
        ? instantSpeed
        : filteredSpeed + GPS_LP_ALPHA * (instantSpeed - filteredSpeed);

    // Bearing between consecutive filtered positions
    if (filteredSpeed >= GPS_MIN_SPEED_FOR_HEADING) {
        const rawBearing = bearingBetween(prevFilteredLat, prevFilteredLng, lat, lng);
        if (filteredBearing === null) {
            filteredBearing = rawBearing;
        } else {
            // Smooth bearing (handle 0/360 wrap)
            let diff = rawBearing - filteredBearing;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            filteredBearing = (filteredBearing + GPS_LP_ALPHA * diff + 360) % 360;
        }
    }

    prevFilteredLat = lat;
    prevFilteredLng = lng;
    lastFilteredTime = now;
}

/**
 * Create or update the user position marker.
 * In driving mode: shows a 🚗 rotated to the heading direction.
 * Otherwise: shows a blue dot.
 */
function updateUserMarker() {
    if (!userLatLng) return;

    const headingDeg = currentHeading !== null ? Math.round(currentHeading) : 0;
    const hasHeading = currentHeading !== null;

    if (drivingMode) {
        // Car icon rotated to heading
        const html = `<div class="car-icon" style="transform: rotate(${headingDeg}deg);">🚗</div>`;
        const icon = L.divIcon({
            className: 'car-marker',
            html: html,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });
        if (!userMarker) {
            userMarker = L.marker(userLatLng, { icon, zIndexOffset: 9999 }).addTo(map);
        } else {
            userMarker.setLatLng(userLatLng);
            userMarker.setIcon(icon);
        }
    } else {
        // Blue dot
        const icon = L.divIcon({
            className: 'user-marker',
            html: '<div class="user-dot"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        if (!userMarker) {
            userMarker = L.marker(userLatLng, { icon, zIndexOffset: 9999 }).addTo(map);
        } else {
            userMarker.setLatLng(userLatLng);
            userMarker.setIcon(icon);
        }
    }
}

/**
 * Calculate heading (bearing) in degrees.
 * Strategy:
 * 1. If on a one-way street (direction_name is set), use that direction.
 * 2. Otherwise, use the low-pass filtered bearing computed from filtered GPS.
 * Returns: degrees (0=north, 90=east, 180=south, 270=west) or null.
 */
function calculateHeading(currentPos) {
    // Strategy 1: Check if user is on a one-way street
    const nearestDir = findNearestLaneDirection(currentPos);
    if (nearestDir !== null) {
        return nearestDir;
    }

    // Strategy 2: Use filtered bearing (already smoothed by low-pass filter)
    if (filteredBearing !== null && filteredSpeed >= GPS_MIN_SPEED_FOR_HEADING) {
        return filteredBearing;
    }

    // Below speed threshold — keep previous heading
    return currentHeading;
}

/**
 * Calculate bearing (degrees) from point A to point B.
 * Returns 0-360 where 0=north, 90=east, 180=south, 270=west.
 */
function bearingBetween(lat1, lng1, lat2, lng2) {
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;

    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
    const bearing = toDeg(Math.atan2(y, x));
    return (bearing + 360) % 360;
}

/**
 * Find the direction of the nearest one-way lane within 30m.
 * Returns heading in degrees, or null if not on a one-way street.
 */
function findNearestLaneDirection(userPos) {
    if (allFeatures.length === 0) return null;

    let minDist = Infinity;
    let nearestDir = null;

    for (const feature of allFeatures) {
        if (!feature.geometry || !feature.geometry.paths) continue;
        const dir = feature.attributes.direction_name;
        if (!dir) continue; // skip if no direction (two-way or unknown)

        const dist = distanceToPolyline(userPos, feature.geometry.paths);
        if (dist < minDist && dist < 30) { // within 30m
            minDist = dist;
            // Map direction to bearing degrees (cardinal + diagonal every 45°)
            const dirMap = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
            if (dirMap[dir] !== undefined) {
                nearestDir = dirMap[dir];
            }
        }
    }

    return nearestDir;
}

function onGpsError(err) {
    console.warn('GPS error:', err.message);
    if (err.code === 1) {
        alert('נדרש אישור GPS. אנא אשר גישה למיקום.');
        stopGps();
    }
}

/**
 * Calculate minimum distance from a point to a polyline in meters
 */
function distanceToPolyline(point, paths) {
    let minDist = Infinity;
    for (const path of paths) {
        for (let i = 0; i < path.length - 1; i++) {
            const a = L.latLng(path[i][1], path[i][0]); // ArcGIS [lng, lat]
            const b = L.latLng(path[i + 1][1], path[i + 1][0]);
            const dist = distPointToSegment(point, a, b);
            if (dist < minDist) minDist = dist;
        }
    }
    return minDist;
}

/**
 * Distance from point P to line segment AB in meters
 */
function distPointToSegment(p, a, b) {
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    if (dx === 0 && dy === 0) return p.distanceTo(a);

    let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    const closest = L.latLng(a.lat + t * dy, a.lng + t * dx);
    return p.distanceTo(closest);
}

/**
 * =========================================================
 *  SEGMENT-AWARE DRIVING ALERTS
 *  1. Find the segment the user is currently driving on
 *     (nearest polyline within 40m; if two-way, use filtered
 *      bearing to pick the correct direction).
 *  2. If that segment has a blocked bus lane → alert (5 min cooldown).
 *  3. Look for a bus-lane camera on the current segment **or**
 *     the next segment in the driving direction.  If distance
 *     < 100 m → camera alert (5 min cooldown per camera).
 *  No other alerts are generated.
 * =========================================================
 */

const SEGMENT_MATCH_RADIUS = 40;   // metres — max distance to snap to a segment
const CAMERA_ALERT_RADIUS  = 100;  // metres — trigger camera alert within this distance

/**
 * Main alert entry-point — called every GPS tick when voice is enabled.
 */
function checkDrivingAlerts(userPos) {
    if (allFeatures.length === 0) return;

    const now      = new Date();
    const nowMs    = Date.now();
    const segment  = findCurrentSegment(userPos);
    currentSegment = segment;                 // expose for other code

    if (!segment) return;                     // not on any known bus-lane street

    const attrs  = segment.feature.attributes;
    const status = getLaneStatus(segment.feature, now);

    // ---- Alert 1: blocked bus lane ----
    if (status.blocked) {
        const key = 'lane_' + attrs.oid;
        if (!alertCooldowns[key] || (nowMs - alertCooldowns[key]) >= ALERT_COOLDOWN_MS) {
            alertCooldowns[key] = nowMs;
            const street = attrs.street_name || 'לא ידוע';
            speakHebrew(`זהירות! נתיב תחבורה ציבורית אסור לנסיעה ברחוב ${street}`);
            showBanner(`🚫 נתיב אסור לנסיעה — ${street}`);
        }
    }

    // ---- Alert 2: bus-lane camera on current or next segment ----
    if (allCameras.length === 0) return;

    // Collect candidate segment OIDs: current + next in driving direction
    const candidateOids = new Set();
    candidateOids.add(attrs.oid);
    const nextSeg = findNextSegment(segment);
    if (nextSeg) candidateOids.add(nextSeg.attributes.oid);

    for (const cam of allCameras) {
        const g = cam.geometry;
        if (!g || g.x === undefined || g.y === undefined) continue;
        const a = cam.attributes;
        if (a.status && a.status !== 'פעיל') continue;

        // Use precomputed camera-segment index
        const mapping = cameraSegmentMap[a.OBJECTID];
        if (!mapping) continue;

        // Check if camera is assigned to any of our candidate segments
        const onCandidate = mapping.segments.some(seg =>
            candidateOids.has(seg.attributes.oid)
        );
        if (!onCandidate) continue;

        // Distance from user to camera
        const camPos = L.latLng(g.y, g.x);
        const dist = userPos.distanceTo(camPos);
        if (dist > CAMERA_ALERT_RADIUS) continue;

        const key = 'cam_' + (a.ms_atar || a.OBJECTID || `${g.y},${g.x}`);
        if (alertCooldowns[key] && (nowMs - alertCooldowns[key]) < ALERT_COOLDOWN_MS) continue;

        alertCooldowns[key] = nowMs;
        const street = a.t_rechov1 || a.name || 'לא ידוע';
        speakHebrew(`זהירות! מצלמת אכיפת נתיב תחבורה ציבורית ברחוב ${street}, ${Math.round(dist)} מטרים`);
        showBanner(`📷 מצלמת נת"צ — ${street} (${Math.round(dist)} מ')`);
        break;  // one camera alert per GPS tick is enough
    }
}

/**
 * Find the GIS segment the user is currently driving on.
 * Returns { feature, dist, travelDirection } or null.
 *   travelDirection: bearing in degrees the user is moving along the segment
 *   (for two-way segments this is derived from filteredBearing).
 */
function findCurrentSegment(userPos) {
    let best = null;
    let bestDist = Infinity;

    for (const feature of allFeatures) {
        if (!feature.geometry || !feature.geometry.paths) continue;
        const dist = distanceToPolyline(userPos, feature.geometry.paths);
        if (dist < bestDist && dist < SEGMENT_MATCH_RADIUS) {
            bestDist = dist;
            best = feature;
        }
    }
    if (!best) return null;

    const dir = best.attributes.direction_name;
    const dirMap = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

    let travelDirection;
    if (dir && dirMap[dir] !== undefined) {
        // One-way — travel direction is known
        travelDirection = dirMap[dir];
    } else if (filteredBearing !== null) {
        // Two-way — use the user's filtered GPS bearing
        travelDirection = filteredBearing;
    } else {
        travelDirection = null;
    }

    return { feature: best, dist: bestDist, travelDirection };
}

/**
 * Given the current segment + driving direction, find the next segment
 * the user will enter (same street_name, matching from/to connection).
 *
 * Segment polylines go from `from_street` → `to_street`.
 * The "next" segment is the one whose `from_street` equals the current
 * segment's `to_street` when driving forward, or vice-versa.
 */
function findNextSegment(current) {
    if (!current || !current.feature) return null;
    const attrs = current.feature.attributes;
    const street = attrs.street_name;
    if (!street) return null;

    // Determine which end of the segment the user is heading toward.
    // Polyline first point ≈ from_street, last point ≈ to_street.
    const paths = current.feature.geometry.paths;
    if (!paths || paths.length === 0 || paths[0].length < 2) return null;

    const firstPt = paths[0][0];                        // [lng, lat]
    const lastPt  = paths[paths.length - 1][ paths[paths.length - 1].length - 1 ];

    const bearingAlongSegment = bearingBetween(
        firstPt[1], firstPt[0],   // from_street end
        lastPt[1],  lastPt[0]     // to_street end
    );

    // Decide if user drives from→to or to→from
    let drivingForward = true;  // default: from → to
    if (current.travelDirection !== null) {
        let diff = current.travelDirection - bearingAlongSegment;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        drivingForward = Math.abs(diff) < 90;
    }

    // The junction we're heading toward
    const targetJunction = drivingForward ? attrs.to_street : attrs.from_street;
    if (!targetJunction) return null;

    // Search for a connecting segment on the same street
    let bestNext = null;
    let bestDist = Infinity;

    for (const feature of allFeatures) {
        if (feature === current.feature) continue;
        const a = feature.attributes;
        if (a.street_name !== street) continue;
        if (!feature.geometry || !feature.geometry.paths) continue;

        // Does this segment connect at the target junction?
        const connectsAtFrom = a.from_street === targetJunction;
        const connectsAtTo   = a.to_street   === targetJunction;
        if (!connectsAtFrom && !connectsAtTo) continue;

        // Prefer the segment that continues in the same direction
        const p  = feature.geometry.paths;
        const fp = p[0][0];
        const lp = p[p.length - 1][ p[p.length - 1].length - 1 ];
        const segBearing = bearingBetween(fp[1], fp[0], lp[1], lp[0]);

        let dirDiff = (current.travelDirection !== null)
            ? Math.abs(current.travelDirection - segBearing)
            : 0;
        if (dirDiff > 180) dirDiff = 360 - dirDiff;

        if (dirDiff < bestDist) {
            bestDist = dirDiff;
            bestNext = feature;
        }
    }

    return bestNext;
}

// =========================================================
//  Speech & banner helpers
// =========================================================

/**
 * Speak a Hebrew sentence via the Web Speech API.
 */
function speakHebrew(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang   = 'he-IL';
    utterance.rate   = 1.1;
    utterance.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const hv = voices.find(v => v.lang.startsWith('he'));
    if (hv) utterance.voice = hv;

    window.speechSynthesis.speak(utterance);
}

/**
 * Show a visual alert banner (auto-hides after 5 s).
 */
function showBanner(text) {
    const banner = document.getElementById('voiceBanner');
    if (!banner) return;
    banner.textContent = text;
    banner.classList.add('show');
    clearTimeout(banner._timeout);
    banner._timeout = setTimeout(() => {
        banner.classList.remove('show');
    }, 5000);
}

// ------ Button handlers ------

function updateGpsButton() {
    const btn = document.getElementById('btnGps');
    if (!btn) return;
    btn.classList.toggle('active', gpsActive);
    btn.textContent = gpsActive ? '📍' : '📍';
}

function updateVoiceButton() {
    const btn = document.getElementById('btnVoice');
    if (!btn) return;
    btn.textContent = voiceEnabled ? '🔊' : '🔇';
    btn.classList.toggle('active', voiceEnabled);
}

function updateDriveButton() {
    const btn = document.getElementById('btnDrive');
    if (!btn) return;
    btn.classList.toggle('active', drivingMode);
}

function toggleGps() {
    if (gpsActive) {
        stopGps();
    } else {
        startGps();
    }
}

function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    updateVoiceButton();

    if (voiceEnabled) {
        // Need to trigger speech from user gesture to unlock audio
        const utterance = new SpeechSynthesisUtterance('התראות קוליות מופעלות');
        utterance.lang = 'he-IL';
        utterance.volume = 0.5;
        window.speechSynthesis.speak(utterance);

        // Auto-enable GPS if not already on
        if (!gpsActive) {
            startGps();
        }
    }
}

function toggleDrivingMode() {
    drivingMode = !drivingMode;
    document.body.classList.toggle('driving-mode', drivingMode);
    updateDriveButton();

    if (drivingMode) {
        // Auto-enable GPS and voice
        if (!gpsActive) startGps();
        if (!voiceEnabled) {
            voiceEnabled = true;
            updateVoiceButton();
        }

        // Switch marker to car icon immediately
        if (userMarker && userLatLng) updateUserMarker();

        // Request wake lock to prevent screen from sleeping
        requestWakeLock();
    } else {
        releaseWakeLock();

        // Switch marker back to blue dot
        if (userMarker && userLatLng) updateUserMarker();
    }
}

// ------ Screen Wake Lock ------

let wakeLock = null;

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('🔆 Screen wake lock acquired');
            wakeLock.addEventListener('release', () => {
                console.log('🔅 Screen wake lock released');
            });
        } catch (err) {
            console.warn('Wake lock failed:', err);
        }
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

// Re-acquire wake lock when page becomes visible again
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && drivingMode) {
        requestWakeLock();
    }
});

function setupDriveControls() {
    const btnVoice = document.getElementById('btnVoice');
    const btnDrive = document.getElementById('btnDrive');

    if (btnVoice) btnVoice.addEventListener('click', toggleVoice);
    if (btnDrive) btnDrive.addEventListener('click', toggleDrivingMode);

    // Reports button
    const btnReports = document.getElementById('btnReports');
    const btnCloseReports = document.getElementById('btnCloseReports');
    if (btnReports) btnReports.addEventListener('click', toggleReportsPanel);
    if (btnCloseReports) btnCloseReports.addEventListener('click', closeReportsPanel);

    // Stop auto-follow when user manually pans
    map.on('dragstart', () => {
        if (followMode) followMode = false;
    });

    // Double-tap on map to re-center on user location
    map.on('dblclick', (e) => {
        if (gpsActive && userLatLng) {
            followMode = true;
            map.setView(userLatLng, 17);
        }
    });

    // Preload voices
    if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

    // Setup photo modal events
    setupPhotoModal();

    // Setup camera report modal events
    setupCameraReportModal();
}

// ============================================================
// Photo Capture & Sign Report
// ============================================================

let pendingReportData = { photoData: null, photoFull: null, lat: null, lng: null, gpsSource: null };

/**
 * Resize/compress a photo to fit in localStorage.
 * Returns a promise that resolves with a smaller base64 JPEG data URL.
 */
function resizePhoto(dataUrl, maxWidth = 800, quality = 0.6) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width;
            let h = img.height;
            if (w > maxWidth) {
                h = Math.round(h * maxWidth / w);
                w = maxWidth;
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(dataUrl); // fallback to original
        img.src = dataUrl;
    });
}

function openPhotoModal() {
    pendingReportData = { photoData: null, photoFull: null, lat: null, lng: null, gpsSource: null };
    document.getElementById('photoPreview').style.display = 'none';
    document.getElementById('photoPreview').src = '';
    document.getElementById('gpsStatus').innerHTML = '';
    document.getElementById('reportStreet').value = '';
    document.getElementById('reportNotes').value = '';
    clearSegmentPicker();
    document.getElementById('photoModal').classList.add('show');
}

function openPhotoModalForStreet(streetName) {
    openPhotoModal();
    if (streetName) {
        document.getElementById('reportStreet').value = streetName;
        populateSegmentPicker(streetName);
    }
    // Close any open popup
    map.closePopup();
}

function closePhotoModal() {
    document.getElementById('photoModal').classList.remove('show');
}

function setupPhotoModal() {
    const modal = document.getElementById('photoModal');
    const inputArea = document.getElementById('photoInputArea');
    const fileInput = document.getElementById('photoFileInput');
    const submitBtn = document.getElementById('btnSubmitReport');
    const cancelBtn = document.getElementById('btnCancelReport');

    if (!modal) return;

    inputArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handlePhotoSelected);
    submitBtn.addEventListener('click', submitReport);
    cancelBtn.addEventListener('click', closePhotoModal);

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closePhotoModal();
    });
}

async function handlePhotoSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Show preview and compress for storage
    const preview = document.getElementById('photoPreview');
    const reader = new FileReader();
    reader.onload = async (ev) => {
        const fullData = ev.target.result;
        preview.src = fullData;
        preview.style.display = 'block';

        // Compress for localStorage (phone photos can be 5-15MB as base64)
        const compressed = await resizePhoto(fullData, 800, 0.6);
        pendingReportData.photoData = compressed;
        pendingReportData.photoFull = null; // don't store full-res
        console.log(`📷 Photo compressed: ${(fullData.length/1024).toFixed(0)}KB → ${(compressed.length/1024).toFixed(0)}KB`);
    };
    reader.readAsDataURL(file);

    // Try to extract GPS from EXIF
    const gpsStatusEl = document.getElementById('gpsStatus');
    gpsStatusEl.innerHTML = '<div class="gps-badge not-found">⏳ מחלץ מיקום מהתמונה...</div>';

    const gps = await extractExifGps(file);

    if (gps && gps.lat && gps.lng) {
        pendingReportData.lat = gps.lat;
        pendingReportData.lng = gps.lng;
        pendingReportData.gpsSource = 'exif';
        gpsStatusEl.innerHTML = `<div class="gps-badge found">📍 מיקום מהתמונה: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}</div>`;

        // Auto-detect nearest street
        autoDetectStreet(gps.lat, gps.lng);
    } else if (userLatLng) {
        // Fall back to current GPS position
        pendingReportData.lat = userLatLng.lat;
        pendingReportData.lng = userLatLng.lng;
        pendingReportData.gpsSource = 'device';
        gpsStatusEl.innerHTML = `<div class="gps-badge manual">📍 מיקום מה-GPS של המכשיר: ${userLatLng.lat.toFixed(5)}, ${userLatLng.lng.toFixed(5)}</div>`;
        autoDetectStreet(userLatLng.lat, userLatLng.lng);
    } else if (navigator.geolocation) {
        // Try one-shot geolocation
        gpsStatusEl.innerHTML = '<div class="gps-badge not-found">⏳ מנסה לקבל מיקום מהמכשיר...</div>';
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                pendingReportData.lat = pos.coords.latitude;
                pendingReportData.lng = pos.coords.longitude;
                pendingReportData.gpsSource = 'device';
                gpsStatusEl.innerHTML = `<div class="gps-badge manual">📍 מיקום מה-GPS: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}</div>`;
                autoDetectStreet(pos.coords.latitude, pos.coords.longitude);
            },
            () => {
                pendingReportData.gpsSource = 'none';
                gpsStatusEl.innerHTML = '<div class="gps-badge not-found">⚠️ לא נמצא מיקום GPS בתמונה או במכשיר. הזן שם רחוב ידנית.</div>';
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    } else {
        pendingReportData.gpsSource = 'none';
        gpsStatusEl.innerHTML = '<div class="gps-badge not-found">⚠️ לא נמצא מיקום GPS. הזן שם רחוב ידנית.</div>';
    }
}

function autoDetectStreet(lat, lng) {
    if (allFeatures.length === 0) return;
    const pos = L.latLng(lat, lng);
    let minDist = Infinity;
    let closestStreet = '';
    let closestOid = null;

    for (const feature of allFeatures) {
        if (!feature.geometry || !feature.geometry.paths) continue;
        const dist = distanceToPolyline(pos, feature.geometry.paths);
        if (dist < minDist) {
            minDist = dist;
            closestStreet = feature.attributes.street_name || '';
            closestOid = feature.attributes.oid;
        }
    }

    if (closestStreet && minDist < 200) {
        const streetInput = document.getElementById('reportStreet');
        if (!streetInput.value) {
            streetInput.value = closestStreet;
            populateSegmentPicker(closestStreet);
        }
        // Auto-select only the nearest segment
        if (closestOid !== null) {
            const checkboxes = document.querySelectorAll('#segmentPicker .segment-cb');
            checkboxes.forEach(cb => {
                cb.checked = parseInt(cb.value) === closestOid;
            });
        }
    }
}

/**
 * Build a datalist of unique street names from GIS features for autocomplete.
 */
function buildStreetAutocomplete() {
    let datalist = document.getElementById('streetSuggestions');
    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'streetSuggestions';
        document.body.appendChild(datalist);
    }
    const streets = new Set();
    for (const f of allFeatures) {
        const name = f.attributes && f.attributes.street_name;
        if (name) streets.add(name);
    }
    datalist.innerHTML = [...streets].sort().map(s => `<option value="${s}">`).join('');
    const input = document.getElementById('reportStreet');
    if (input) {
        input.setAttribute('list', 'streetSuggestions');
        // When user picks or types a street, populate segment picker
        input.addEventListener('change', () => populateSegmentPicker(input.value.trim()));
        input.addEventListener('input', debounceSegmentPicker(input));
    }
}

/** Debounce segment picker population on typing */
function debounceSegmentPicker(input) {
    let timer = null;
    return () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const val = input.value.trim();
            if (val && getSegmentsForStreet(val).length > 0) {
                populateSegmentPicker(val);
            }
        }, 400);
    };
}

/**
 * Get all GIS feature segments matching a street name.
 * Returns array of { oid, from, to, dir, dirText, feature }
 */
function getSegmentsForStreet(streetName) {
    if (!streetName || allFeatures.length === 0) return [];
    const norm = normalizeStreet(streetName);
    const aliased = STREET_ALIASES[norm] || norm;

    return allFeatures.filter(f => {
        const fName = normalizeStreet(f.attributes.street_name);
        return fName === norm || fName === aliased || norm === fName;
    }).map(f => {
        const a = f.attributes;
        const dirMap = { E: 'מזרח', W: 'מערב', N: 'צפון', S: 'דרום' };
        return {
            oid: a.oid,
            from: a.from_street || '?',
            to: a.to_street || '?',
            dir: a.direction_name || '',
            dirText: dirMap[a.direction_name] || '',
            feature: f
        };
    });
}

/**
 * Populate the segment picker with checkboxes for all segments of the given street.
 */
function populateSegmentPicker(streetName) {
    const container = document.getElementById('segmentPicker');
    const group = document.getElementById('segmentPickerGroup');
    if (!container || !group) return;

    const segments = getSegmentsForStreet(streetName);
    if (segments.length === 0) {
        group.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    group.style.display = '';
    container.innerHTML = segments.map(seg => {
        const dirLabel = seg.dirText ? ` (${seg.dirText})` : '';
        return `<label>
            <input type="checkbox" class="segment-cb" value="${seg.oid}" checked>
            <span>${seg.from} → ${seg.to}${dirLabel}</span>
        </label>`;
    }).join('');
}

/**
 * Clear the segment picker.
 */
function clearSegmentPicker() {
    const container = document.getElementById('segmentPicker');
    const group = document.getElementById('segmentPickerGroup');
    if (container) container.innerHTML = '';
    if (group) group.style.display = 'none';
}

/**
 * Get the list of selected segment OIDs from the picker.
 */
function getSelectedSegmentOids() {
    const checkboxes = document.querySelectorAll('#segmentPicker .segment-cb:checked');
    return Array.from(checkboxes).map(cb => parseInt(cb.value));
}

async function submitReport() {
    const street = document.getElementById('reportStreet').value.trim();
    const notes = document.getElementById('reportNotes').value.trim();
    const selectedOids = getSelectedSegmentOids();

    if (!street) {
        alert('נא להזין שם רחוב');
        return;
    }

    // Build section description from selected segments
    const segments = getSegmentsForStreet(street);
    const selectedSegments = segments.filter(s => selectedOids.includes(s.oid));
    const sectionDesc = selectedSegments.map(s => `${s.from}→${s.to}`).join(', ');

    const report = {
        street: street,
        section: sectionDesc,
        notes: notes,
        lat: pendingReportData.lat,
        lng: pendingReportData.lng,
        gpsSource: pendingReportData.gpsSource,
        photoData: pendingReportData.photoData || null,
        decodedHours: null,
        featureIds: selectedOids.length > 0 ? selectedOids : null
    };

    console.log('📋 submitReport: photoData size =', (report.photoData || '').length, 'bytes');
    const saved = await addCommunityReport(report);
    console.log('📋 submitReport: addCommunityReport returned:', saved);
    if (!saved) {
        alert('שגיאה בשמירת הדיווח. ייתכן שהזיכרון מלא — נסה למחוק דיווחים ישנים.');
        return;
    }
    // Verify it was actually saved
    const verify = loadCommunityReports();
    console.log('📋 submitReport: verify — reports in storage:', verify.length);

    closePhotoModal();

    showBanner(`🪧 דיווח שלט נשמר — ${street}`);
    console.log('📋 New sign report:', street, report.lat, report.lng);

    // Reset file input
    document.getElementById('photoFileInput').value = '';
}

// ============================================================
// Camera Direction Report
// ============================================================

let pendingCameraReportData = { camObjectId: null, photoData: null };

/**
 * Open camera report modal for a bidirectional camera.
 * User can photograph the camera and submit a report so a human
 * (or future bot) can determine which direction it faces.
 */
function openCameraReportModal(camObjectId) {
    pendingCameraReportData = { camObjectId, photoData: null };

    // Find camera info
    const cam = allCameras.find(c => c.attributes.OBJECTID === camObjectId);
    const mapping = cameraSegmentMap[camObjectId];

    const modal = document.getElementById('cameraReportModal');
    if (!modal) return;

    // Fill in camera info
    const infoEl = document.getElementById('camReportInfo');
    if (infoEl && cam) {
        const a = cam.attributes;
        const segDescs = (mapping ? mapping.segments : []).map(seg => {
            const sa = seg.attributes;
            const dirMap = { N: '↑צפון', NE: '↗צפ-מזרח', E: '→מזרח', SE: '↘דרום-מזרח', S: '↓דרום', SW: '↙דרום-מערב', W: '←מערב', NW: '↖צפ-מערב' };
            const dirText = dirMap[sa.direction_name] || 'דו-כיווני';
            return `${sa.from_street || '?'} → ${sa.to_street || '?'} (${dirText})`;
        }).join('<br>');
        infoEl.innerHTML = `
            <strong>${a.name || ''}</strong><br>
            <span style="font-size:12px;color:#666;">רחוב: ${a.t_rechov1 || '?'} ${a.ms_bayit1 || ''}</span><br>
            <span style="font-size:12px;color:#f39c12;">↔ מסווגת לשני כיוונים:</span><br>
            <span style="font-size:12px;">${segDescs}</span>
        `;
    }

    // Reset photo
    document.getElementById('camPhotoPreview').style.display = 'none';
    document.getElementById('camPhotoPreview').src = '';
    document.getElementById('camReportNotes').value = '';

    modal.classList.add('show');
    map.closePopup();
}

function closeCameraReportModal() {
    document.getElementById('cameraReportModal').classList.remove('show');
}

function setupCameraReportModal() {
    const modal = document.getElementById('cameraReportModal');
    if (!modal) return;

    const inputArea = document.getElementById('camPhotoInputArea');
    const fileInput = document.getElementById('camPhotoFileInput');
    const submitBtn = document.getElementById('btnSubmitCamReport');
    const cancelBtn = document.getElementById('btnCancelCamReport');

    inputArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleCameraPhotoSelected);
    submitBtn.addEventListener('click', submitCameraReport);
    cancelBtn.addEventListener('click', closeCameraReportModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeCameraReportModal();
    });
}

async function handleCameraPhotoSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    const preview = document.getElementById('camPhotoPreview');

    // Compress
    const compressed = await resizePhoto(file);
    if (compressed) {
        pendingCameraReportData.photoData = compressed;
        preview.src = compressed;
        preview.style.display = 'block';
    } else {
        // Fallback: read original
        const reader = new FileReader();
        reader.onload = (ev) => {
            pendingCameraReportData.photoData = ev.target.result;
            preview.src = ev.target.result;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

async function submitCameraReport() {
    const notes = document.getElementById('camReportNotes').value.trim();
    const camId = pendingCameraReportData.camObjectId;

    if (!pendingCameraReportData.photoData) {
        alert('נא לצלם את המצלמה');
        return;
    }

    const cam = allCameras.find(c => c.attributes.OBJECTID === camId);
    const a = cam ? cam.attributes : {};
    const g = cam ? cam.geometry : {};

    const report = {
        type: 'camera_direction',
        street: a.t_rechov1 || '',
        cameraObjectId: camId,
        cameraName: a.name || '',
        cameraMsAtar: a.ms_atar || null,
        notes: notes,
        lat: g.y || null,
        lng: g.x || null,
        gpsSource: 'camera_location',
        photoData: pendingCameraReportData.photoData,
        decodedHours: null,
        featureIds: null
    };

    const saved = await addCommunityReport(report);
    if (!saved) {
        alert('שגיאה בשמירת הדיווח. ייתכן שהזיכרון מלא — נסה למחוק דיווחים ישנים.');
        return;
    }

    closeCameraReportModal();
    showBanner(`📷 דיווח מצלמה נשמר — ${a.name || a.t_rechov1 || ''}`);
    console.log('📷 Camera report saved for camera', camId);

    // Reset file input
    document.getElementById('camPhotoFileInput').value = '';
}

// ============================================================
// Reports Panel
// ============================================================

function toggleReportsPanel() {
    const panel = document.getElementById('reportsPanel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        renderReportsList();
    }
}

function closeReportsPanel() {
    document.getElementById('reportsPanel').classList.remove('open');
}

function renderReportsList() {
    const container = document.getElementById('reportsList');
    const reports = loadCommunityReports();
    console.log('📋 renderReportsList: loaded', reports.length, 'reports from localStorage');

    if (reports.length === 0) {
        container.innerHTML = `
            <div class="reports-empty">
                <div class="empty-icon">🪧</div>
                <div>אין דיווחי שלטים עדיין</div>
                <div style="font-size: 13px; margin-top: 8px;">לחץ על 🪧 כדי לצלם שלט נת"צ</div>
            </div>`;
        return;
    }

    // Sort newest first
    const sorted = [...reports].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    container.innerHTML = sorted.map(r => renderReportCard(r)).join('');
}

function renderReportCard(report) {
    const date = new Date(report.timestamp).toLocaleString('he-IL', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const isCameraReport = report.type === 'camera_direction';
    const icon = isCameraReport ? '📷' : '🪧';
    const title = isCameraReport ? (report.cameraName || report.street || 'מצלמה') : report.street;

    const statusLabels = { pending: 'ממתין לפענוח', decoded: 'פוענח', rejected: 'נדחה' };
    const statusLabel = statusLabels[report.status] || report.status;
    const photoUrl = getReportPhoto(report.id);
    const hasPhoto = photoUrl ? `<img class="report-card-photo" src="${photoUrl}" onclick="window.open(this.src)">` : '';
    const gpsInfo = report.lat ? `📍 ${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}` : 'ללא מיקום';

    let decodedInfo = '';
    if (report.status === 'decoded' && report.decodedHours) {
        const h = report.decodedHours;
        const parts = [];
        if (h.allWeek) parts.push('כל השבוע 24/7');
        if (h.sun_thu && h.sun_thu.length) parts.push(`א-ה: ${h.sun_thu.map(r => formatHour(r[0]) + '-' + formatHour(r[1])).join(', ')}`);
        if (h.fri && h.fri.length) parts.push(`ו: ${h.fri.map(r => formatHour(r[0]) + '-' + formatHour(r[1])).join(', ')}`);
        if (h.sat && h.sat.length) parts.push(`ש: ${h.sat.map(r => formatHour(r[0]) + '-' + formatHour(r[1])).join(', ')}`);
        decodedInfo = `<div style="font-size: 12px; margin-top: 4px; padding: 4px 8px; background: #d4edda; border-radius: 6px;">🕐 ${parts.join(' | ')}</div>`;
    }

    const cameraInfoHtml = isCameraReport
        ? `<div class="report-card-meta">מצלמה: ${report.cameraName || ''} (אתר ${report.cameraMsAtar || '?'})</div>`
        : '';

    // Decode/edit actions only for sign reports (not camera direction reports)
    const decodeActions = !isCameraReport ? `
        ${report.status === 'pending' ? `<button class="report-action-btn primary" onclick="showDecodeForm('${report.id}')">🔍 פענח שעות</button>` : ''}
        ${report.status === 'decoded' ? `<button class="report-action-btn primary" onclick="showDecodeForm('${report.id}')">✏️ ערוך שעות</button>` : ''}
    ` : '';

    return `
        <div class="report-card" id="report-${report.id}">
            <div class="report-card-header">
                <span class="report-card-street">${icon} ${title}</span>
                <span class="report-status-badge ${report.status}">${statusLabel}</span>
            </div>
            ${hasPhoto}
            <div class="report-card-meta">${date} · ${gpsInfo}</div>
            ${cameraInfoHtml}
            ${report.featureIds && report.featureIds.length > 0 ? `<div class="report-card-meta">📍 ${report.featureIds.length} קטעים נבחרו</div>` : ''}
            ${report.section ? `<div class="report-card-meta">קטע: ${report.section}</div>` : ''}
            ${report.notes ? `<div class="report-card-meta">הערות: ${report.notes}</div>` : ''}
            ${decodedInfo}
            <div class="report-card-actions">
                ${decodeActions}
                <button class="report-action-btn" onclick="zoomToReport('${report.id}')">🗺️ הצג במפה</button>
                <button class="report-action-btn danger" onclick="deleteReport('${report.id}')">🗑️ מחק</button>
            </div>
            <div id="decode-form-${report.id}"></div>
        </div>
    `;
}

function showDecodeForm(reportId) {
    const formContainer = document.getElementById(`decode-form-${reportId}`);
    if (!formContainer) return;

    const reports = loadCommunityReports();
    const report = reports.find(r => r.id === reportId);
    if (!report) return;

    // Pre-fill from existing decoded hours
    const h = report.decodedHours || {};
    const sunThu = h.sun_thu ? h.sun_thu.map(r => `${formatHour(r[0])}-${formatHour(r[1])}`).join(', ') : '';
    const fri = h.fri ? h.fri.map(r => `${formatHour(r[0])}-${formatHour(r[1])}`).join(', ') : '';
    const sat = h.sat ? h.sat.map(r => `${formatHour(r[0])}-${formatHour(r[1])}`).join(', ') : '';
    const allWeek = h.allWeek ? 'checked' : '';

    // Build segment checkboxes for the decode form
    const segments = getSegmentsForStreet(report.street);
    const existingIds = report.featureIds || [];
    let segmentHtml = '';
    if (segments.length > 0) {
        const segItems = segments.map(seg => {
            const dirLabel = seg.dirText ? ` (${seg.dirText})` : '';
            // If report already has featureIds, check only those; else check all
            const isChecked = existingIds.length > 0 ? existingIds.includes(seg.oid) : true;
            return `<label>
                <input type="checkbox" class="decode-seg-cb-${reportId}" value="${seg.oid}" ${isChecked ? 'checked' : ''}>
                <span>${seg.from} → ${seg.to}${dirLabel}</span>
            </label>`;
        }).join('');
        segmentHtml = `
            <label style="margin-top: 8px; font-weight: 700;">קטעים שהשלט חל עליהם:</label>
            <div class="segment-picker">${segItems}</div>
        `;
    }

    formContainer.innerHTML = `
        <div class="decode-form">
            <div class="decode-help">הזן שעות הגבלה כפי שכתוב על השלט. פורמט: 07:00-22:00 (מופרד בפסיק אם יש כמה טווחים)</div>
            <label><input type="checkbox" id="decode-allweek-${reportId}" ${allWeek}> כל ימות השבוע 24/7</label>
            <label>א׳-ה׳:</label>
            <input type="text" id="decode-sunth-${reportId}" value="${sunThu}" placeholder="07:00-22:00" dir="ltr">
            <label>ו׳ / ערבי חג:</label>
            <input type="text" id="decode-fri-${reportId}" value="${fri}" placeholder="07:00-17:00" dir="ltr">
            <label>שבת / חג:</label>
            <input type="text" id="decode-sat-${reportId}" value="${sat}" placeholder="" dir="ltr">
            ${segmentHtml}
            <div class="decode-actions">
                <button class="report-action-btn primary" onclick="saveDecodeForm('${reportId}')">💾 שמור</button>
                <button class="report-action-btn" onclick="cancelDecodeForm('${reportId}')">ביטול</button>
            </div>
        </div>
    `;
}

function cancelDecodeForm(reportId) {
    const el = document.getElementById(`decode-form-${reportId}`);
    if (el) el.innerHTML = '';
}

function parseTimeRanges(str) {
    if (!str || !str.trim()) return null;
    const ranges = [];
    const parts = str.split(',');
    for (const part of parts) {
        const match = part.trim().match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (match) {
            const start = parseInt(match[1]) + parseInt(match[2]) / 60;
            const end = parseInt(match[3]) + parseInt(match[4]) / 60;
            ranges.push([start, end]);
        }
    }
    return ranges.length > 0 ? ranges : null;
}

function saveDecodeForm(reportId) {
    const allWeek = document.getElementById(`decode-allweek-${reportId}`).checked;
    const sunThuStr = document.getElementById(`decode-sunth-${reportId}`).value;
    const friStr = document.getElementById(`decode-fri-${reportId}`).value;
    const satStr = document.getElementById(`decode-sat-${reportId}`).value;

    const decodedHours = {
        allWeek: allWeek,
        sun_thu: allWeek ? null : parseTimeRanges(sunThuStr),
        fri: allWeek ? null : parseTimeRanges(friStr),
        sat: allWeek ? null : parseTimeRanges(satStr)
    };

    // Collect selected segment OIDs from decode form checkboxes
    const segCbs = document.querySelectorAll(`.decode-seg-cb-${reportId}:checked`);
    const featureIds = Array.from(segCbs).map(cb => parseInt(cb.value));

    updateCommunityReport(reportId, {
        status: 'decoded',
        decodedHours: decodedHours,
        featureIds: featureIds.length > 0 ? featureIds : null
    });

    // Re-render
    renderReportsList();

    // Re-render lanes to apply the override
    if (allFeatures.length > 0) {
        renderLanes(allFeatures, new Date());
    }

    showBanner('🪧✅ שעות השלט נשמרו — המפה עודכנה');
}

function deleteReport(reportId) {
    if (!confirm('למחוק את הדיווח?')) return;
    deleteCommunityReport(reportId);
    renderReportsList();

    // Re-render lanes
    if (allFeatures.length > 0) {
        renderLanes(allFeatures, new Date());
    }
}

function zoomToReport(reportId) {
    const reports = loadCommunityReports();
    const report = reports.find(r => r.id === reportId);
    if (!report || !report.lat || !report.lng) {
        alert('אין מיקום GPS לדיווח זה');
        return;
    }
    map.setView([report.lat, report.lng], 18);
    closeReportsPanel();
}

// ============================================================
// Service Worker Registration
// ============================================================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
            .then(reg => {
                console.log('✅ Service Worker registered');
                // Force check for updates
                reg.update();
            })
            .catch(err => console.warn('SW registration failed:', err));
    }
}

// ============================================================
// Driving Simulator
// ============================================================

let simActive = false;          // simulator panel open?
let simPlanning = false;        // true = planning phase, false = playing
let simRoute = [];              // ordered array of route items: { type:'segment'|'waypoint', feature?, latlng?, label? }
let simPlaying = false;         // animation running?
let simAnimFrame = null;        // requestAnimationFrame id
let simCarMarker = null;        // the simulator car marker
let simHighlightLayer = null;   // layer group for route highlights
let simCurrentIdx = 0;          // current segment index during playback
let simProgress = 0;            // 0..1 progress along current segment
let simLastTime = 0;            // last animation timestamp
let _simMapClickHandler = null; // reference to map click handler
const SIM_SPEED_KMH = 75;      // km/h
const SIM_SPEED_MPS = SIM_SPEED_KMH / 3.6;  // ~20.83 m/s

/**
 * Toggle the simulator panel open/closed.
 */
function toggleSimulator() {
    const panel = document.getElementById('simPanel');
    if (!panel) return;
    simActive = !simActive;
    panel.classList.toggle('open', simActive);
    document.getElementById('btnSimulator').classList.toggle('active', simActive);

    if (simActive) {
        enterSimPlanning();
    } else {
        exitSimulator();
    }
}

/**
 * Enter planning phase — click anywhere on map to add waypoints/segments.
 */
function enterSimPlanning() {
    simPlanning = true;
    simPlaying = false;
    document.body.classList.add('sim-planning');
    document.getElementById('simPhaseLabel').textContent = 'שלב תכנון — לחץ בכל מקום על המפה';
    document.getElementById('simStartBtn').style.display = '';
    document.getElementById('simStopBtn').style.display = 'none';

    // Disable popups on lane polylines so clicks pass through to map
    _disableLanePopups();

    // Use map click for route building
    _removeSimMapClick();
    _simMapClickHandler = function(e) { onSimMapClick(e); };
    map.on('click', _simMapClickHandler);

    // Also add direct click on polylines as fallback (in case bubbling fails)
    laneLayerGroup.eachLayer(layer => {
        layer._simClickFn = function(e) {
            L.DomEvent.stopPropagation(e);  // prevent double-fire
            onSimMapClick(e);
        };
        layer.on('click', layer._simClickFn);
    });

    renderSimRouteList();
}

function _removeSimMapClick() {
    if (_simMapClickHandler) {
        map.off('click', _simMapClickHandler);
        _simMapClickHandler = null;
    }
}

/**
 * Temporarily unbind popups from lane polylines so clicks propagate to the map.
 */
function _disableLanePopups() {
    map.closePopup();
    laneLayerGroup.eachLayer(layer => {
        if (layer.getPopup()) {
            layer._simSavedPopup = layer.getPopup();
            layer.unbindPopup();
        }
    });
}

/**
 * Re-bind saved popups on lane polylines after planning is done.
 */
function _restoreLanePopups() {
    laneLayerGroup.eachLayer(layer => {
        // Remove direct sim click handler
        if (layer._simClickFn) {
            layer.off('click', layer._simClickFn);
            delete layer._simClickFn;
        }
        // Restore popup
        if (layer._simSavedPopup) {
            layer.bindPopup(layer._simSavedPopup);
            delete layer._simSavedPopup;
        }
    });
}

/**
 * Completely exit the simulator and clean up.
 */
function exitSimulator() {
    stopSimPlayback();
    simActive = false;
    simPlanning = false;
    simRoute = [];
    document.body.classList.remove('sim-planning');
    document.getElementById('btnSimulator').classList.remove('active');

    // Remove map click handler and restore popups
    _removeSimMapClick();
    _restoreLanePopups();

    // Remove highlight layer
    if (simHighlightLayer) {
        map.removeLayer(simHighlightLayer);
        simHighlightLayer = null;
    }

    // Remove car marker
    if (simCarMarker) {
        map.removeLayer(simCarMarker);
        simCarMarker = null;
    }

    renderSimRouteList();
}

/**
 * Handle click on the map during planning phase.
 * If near a bus lane segment (< 40m), add that segment.
 * Otherwise, add a free waypoint at the click location.
 */
function onSimMapClick(e) {
    if (!simPlanning) return;

    const clickPt = e.latlng;

    // Check if click is near a bus lane segment
    let bestFeature = null;
    let bestDist = Infinity;
    for (const f of allFeatures) {
        if (!f.geometry || !f.geometry.paths) continue;
        const d = distanceToPolyline(clickPt, f.geometry.paths);
        if (d < bestDist) {
            bestDist = d;
            bestFeature = f;
        }
    }

    if (bestFeature && bestDist < 40) {
        // Check duplicate bus lane segments
        if (simRoute.some(item => item.type === 'segment' && item.feature.attributes.oid === bestFeature.attributes.oid)) {
            showBanner('⚠️ מקטע זה כבר במסלול');
            return;
        }
        const a = bestFeature.attributes;
        simRoute.push({
            type: 'segment',
            feature: bestFeature,
            label: `${a.street_name || '?'}  (${a.from_street || '?'} → ${a.to_street || '?'})`
        });
    } else {
        // Free waypoint — any street
        simRoute.push({
            type: 'waypoint',
            latlng: [clickPt.lat, clickPt.lng],
            label: `📍 ${clickPt.lat.toFixed(5)}, ${clickPt.lng.toFixed(5)}`
        });
    }

    renderSimRouteList();
    updateSimHighlight();
    updateSimStartButton();
}

/**
 * Determine the authoritative traffic direction bearing for a feature.
 * Uses direction_name as truth. If geometry goes opposite, we know to flip.
 * Returns bearing in degrees (0=N, 90=E, 180=S, 270=W).
 */
const DIR_NAME_TO_BEARING = { 'N':0, 'NE':45, 'E':90, 'SE':135, 'S':180, 'SW':225, 'W':270, 'NW':315 };

function getFeatureTrafficBearing(feature) {
    const dir = feature.attributes.direction_name;
    if (dir && DIR_NAME_TO_BEARING[dir] !== undefined) {
        return DIR_NAME_TO_BEARING[dir];
    }
    // Fallback: compute from geometry
    const paths = feature.geometry && feature.geometry.paths;
    if (!paths || paths.length === 0) return 0;
    const allPts = [];
    paths.forEach(p => p.forEach(c => allPts.push(c)));
    if (allPts.length < 2) return 0;
    return bearingBetween(allPts[0][1], allPts[0][0], allPts[allPts.length-1][1], allPts[allPts.length-1][0]);
}

/**
 * Check if the geometry vertex order goes opposite to the traffic direction.
 * Returns true if geometry needs to be reversed to match traffic flow.
 */
function isGeometryReversed(feature) {
    const dir = feature.attributes.direction_name;
    if (!dir || DIR_NAME_TO_BEARING[dir] === undefined) return false;
    const paths = feature.geometry && feature.geometry.paths;
    if (!paths || paths.length === 0) return false;
    const allPts = [];
    paths.forEach(p => p.forEach(c => allPts.push(c)));
    if (allPts.length < 2) return false;
    const geoBearing = bearingBetween(allPts[0][1], allPts[0][0], allPts[allPts.length-1][1], allPts[allPts.length-1][0]);
    const expected = DIR_NAME_TO_BEARING[dir];
    let diff = Math.abs(geoBearing - expected);
    if (diff > 180) diff = 360 - diff;
    return diff > 90;
}

/**
 * Convert a direction name to an arrow emoji.
 */
function getDirectionArrow(item) {
    if (item.type === 'waypoint') return '';
    const bearing = getFeatureTrafficBearing(item.feature);
    const idx = Math.round(((bearing + 360) % 360) / 45) % 8;
    return ['⬆️','↗️','➡️','↘️','⬇️','↙️','⬅️','↖️'][idx];
}

/**
 * Get ordered [lat,lng] points for a feature, in the TRAFFIC direction.
 * Reverses geometry if needed so points go in the direction vehicles drive.
 */
function getFeaturePointsInTrafficOrder(feature) {
    const paths = feature.geometry && feature.geometry.paths;
    if (!paths) return [];
    const pts = [];
    paths.forEach(p => p.forEach(c => pts.push([c[1], c[0]])));
    if (isGeometryReversed(feature)) pts.reverse();
    return pts;
}

/**
 * Remove a segment from the planned route by index.
 */
function simRemoveSegment(idx) {
    simRoute.splice(idx, 1);
    renderSimRouteList();
    updateSimHighlight();
    updateSimStartButton();
}

/**
 * Render the route list in the panel.
 */
function renderSimRouteList() {
    const container = document.getElementById('simRouteList');
    if (!container) return;

    if (simRoute.length === 0) {
        container.innerHTML = '<div class="sim-empty">לחץ בכל מקום על המפה כדי לבנות מסלול.<br>ליד נתיב נת"צ — יתווסף המקטע.<br>בכל מקום אחר — נקודת ציון חופשית.</div>';
        return;
    }

    container.innerHTML = simRoute.map((item, i) => {
        const activeClass = (!simPlanning && simPlaying && i === simCurrentIdx) ? ' active' : '';
        const removeBtn = simPlanning ? `<button class="seg-remove" onclick="simRemoveSegment(${i})">✕</button>` : '';

        if (item.type === 'segment') {
            const a = item.feature.attributes;
            const now = new Date();
            const status = getLaneStatus(item.feature, now);
            const blockedClass = status.blocked ? ' sim-blocked' : '';
            const statusEmoji = status.blocked ? '🔴' : (status.category === 'unknown' ? '⚪' : '🟢');
            const dirArrow = getDirectionArrow(item);
            return `<div class="sim-seg-item${blockedClass}${activeClass}" id="sim-seg-${i}">
                <div class="seg-num">${i + 1}</div>
                <div class="seg-info">
                    <div class="seg-street">${statusEmoji} ${a.street_name || '?'} ${dirArrow}</div>
                    <div class="seg-section">${a.from_street || '?'} → ${a.to_street || '?'}</div>
                    <div class="seg-dir">${a.direction_name ? 'כיוון: ' + a.direction_name : ''}</div>
                </div>
                ${removeBtn}
            </div>`;
        } else {
            // waypoint
            return `<div class="sim-seg-item${activeClass}" id="sim-seg-${i}">
                <div class="seg-num" style="background:#f39c12;">${i + 1}</div>
                <div class="seg-info">
                    <div class="seg-street">📍 נקודת ציון</div>
                    <div class="seg-section">${item.latlng[0].toFixed(5)}, ${item.latlng[1].toFixed(5)}</div>
                </div>
                ${removeBtn}
            </div>`;
        }
    }).join('');
}

/**
 * Highlight the planned route on the map.
 */
function updateSimHighlight() {
    if (simHighlightLayer) {
        map.removeLayer(simHighlightLayer);
    }
    simHighlightLayer = L.layerGroup().addTo(map);

    const allPts = [];

    simRoute.forEach((item, i) => {
        if (item.type === 'segment' && item.feature.geometry && item.feature.geometry.paths) {
            const latLngs = arcgisPathsToLatLngs(item.feature.geometry.paths);
            latLngs.forEach(path => {
                L.polyline(path, {
                    color: '#f1c40f',
                    weight: 8,
                    opacity: 0.8,
                    dashArray: '10 6'
                }).addTo(simHighlightLayer);
                path.forEach(pt => allPts.push(pt));
            });

            // Add direction arrow markers along segment — traffic order
            const trafficPts = getFeaturePointsInTrafficOrder(item.feature);
            if (trafficPts.length >= 2) {
                const totalLen = trafficPts.reduce((sum, pt, j) => {
                    if (j === 0) return 0;
                    return sum + L.latLng(trafficPts[j - 1]).distanceTo(L.latLng(pt));
                }, 0);
                const numArrows = Math.max(1, Math.round(totalLen / 100));
                for (let a = 0; a < numArrows; a++) {
                    const frac = (a + 0.5) / numArrows;
                    const ptIdx = Math.min(Math.floor(frac * trafficPts.length), trafficPts.length - 1);
                    const prevIdx = Math.max(0, ptIdx - 1);
                    const nextIdx = Math.min(trafficPts.length - 1, ptIdx + 1);
                    const localBearing = bearingBetween(
                        trafficPts[prevIdx][0], trafficPts[prevIdx][1],
                        trafficPts[nextIdx][0], trafficPts[nextIdx][1]
                    );
                    const arrowIcon = L.divIcon({
                        className: 'sim-arrow-icon',
                        html: `<div style="transform: rotate(${localBearing}deg); font-size: 20px; line-height:1;">⬆</div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });
                    L.marker(trafficPts[ptIdx], { icon: arrowIcon, interactive: false }).addTo(simHighlightLayer);
                }
            }
        } else if (item.type === 'waypoint') {
            const pt = item.latlng;
            allPts.push(pt);
            L.circleMarker(pt, {
                radius: 8,
                color: '#f39c12',
                fillColor: '#f1c40f',
                fillOpacity: 0.9,
                weight: 2
            }).addTo(simHighlightLayer);
        }
    });

    // Connect consecutive route items via OSRM road routing
    if (simRoute.length >= 2) {
        fetchOSRMConnectors(simRoute, simHighlightLayer, allPts);
    }

    // Fit map to route
    if (allPts.length > 0) {
        map.fitBounds(L.latLngBounds(allPts).pad(0.2));
    }
}

/**
 * Get the endpoint [lat,lng] of a route item.
 * For segments, returns the END point (in traffic direction).
 */
function getRouteItemEnd(item) {
    if (item.type === 'waypoint') return item.latlng;
    const pts = getFeaturePointsInTrafficOrder(item.feature);
    return pts.length > 0 ? pts[pts.length - 1] : null;
}

/**
 * Get the start point [lat,lng] of a route item.
 * For segments, returns the START point (in traffic direction).
 */
function getRouteItemStart(item) {
    if (item.type === 'waypoint') return item.latlng;
    const pts = getFeaturePointsInTrafficOrder(item.feature);
    return pts.length > 0 ? pts[0] : null;
}

/**
 * Fetch OSRM road-following routes between consecutive route items.
 * Draws them as dashed orange polylines on the highlight layer.
 * Also stores connector paths in simRoute items for buildSimPath.
 */
async function fetchOSRMConnectors(route, highlightLayer, allPtsRef) {
    for (let i = 0; i < route.length - 1; i++) {
        const endPt = getRouteItemEnd(route[i]);
        const startPt = getRouteItemStart(route[i + 1]);
        if (!endPt || !startPt) continue;

        const dist = L.latLng(endPt).distanceTo(L.latLng(startPt));
        if (dist < 10) {
            route[i]._connector = null; // segments are close enough
            continue;
        }

        try {
            // OSRM expects lng,lat
            const url = `https://router.project-osrm.org/route/v1/driving/${endPt[1]},${endPt[0]};${startPt[1]},${startPt[0]}?overview=full&geometries=geojson`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (data.code === 'Ok' && data.routes && data.routes[0]) {
                const coords = data.routes[0].geometry.coordinates; // [lng, lat]
                const connPts = coords.map(c => [c[1], c[0]]); // [lat, lng]
                route[i]._connector = connPts;

                L.polyline(connPts, {
                    color: '#f39c12',
                    weight: 4,
                    opacity: 0.7,
                    dashArray: '6 8'
                }).addTo(highlightLayer);
                connPts.forEach(pt => allPtsRef.push(pt));
            } else {
                route[i]._connector = null;
            }
        } catch (e) {
            console.warn('OSRM routing failed for connector', i, e);
            route[i]._connector = null;
        }
    }
}

function updateSimStartButton() {
    const btn = document.getElementById('simStartBtn');
    if (btn) btn.disabled = simRoute.length === 0;
}

/**
 * Build a continuous array of [lat, lng] points from the route segments.
 * Ensures segments are connected end-to-end.
 */
function buildSimPath() {
    const points = [];

    function addPoint(pt) {
        if (points.length > 0) {
            const last = points[points.length - 1];
            if (L.latLng(last).distanceTo(L.latLng(pt)) < 3) return;
        }
        points.push(pt);
    }

    for (let i = 0; i < simRoute.length; i++) {
        const item = simRoute[i];

        if (item.type === 'waypoint') {
            addPoint(item.latlng);
        } else {
            // Use traffic-ordered points for correct driving direction
            const segPts = getFeaturePointsInTrafficOrder(item.feature);
            segPts.forEach(pt => addPoint(pt));
        }

        // Add OSRM connector to next segment (if available)
        if (item._connector && item._connector.length > 0) {
            item._connector.forEach(pt => addPoint(pt));
        }
    }

    return points;
}

/**
 * Precompute cumulative distances along the path.
 */
function buildCumulativeDistances(path) {
    const dists = [0];
    for (let i = 1; i < path.length; i++) {
        const d = L.latLng(path[i - 1]).distanceTo(L.latLng(path[i]));
        dists.push(dists[i - 1] + d);
    }
    return dists;
}

/**
 * Interpolate position along the path at a given distance.
 */
function interpolateOnPath(path, cumDists, distance) {
    if (distance <= 0) return { lat: path[0][0], lng: path[0][1] };
    if (distance >= cumDists[cumDists.length - 1]) {
        const last = path[path.length - 1];
        return { lat: last[0], lng: last[1] };
    }

    for (let i = 1; i < cumDists.length; i++) {
        if (cumDists[i] >= distance) {
            const segLen = cumDists[i] - cumDists[i - 1];
            const t = segLen > 0 ? (distance - cumDists[i - 1]) / segLen : 0;
            const lat = path[i - 1][0] + t * (path[i][0] - path[i - 1][0]);
            const lng = path[i - 1][1] + t * (path[i][1] - path[i - 1][1]);
            return { lat, lng, segIdx: i - 1 };
        }
    }
    const last = path[path.length - 1];
    return { lat: last[0], lng: last[1] };
}

/**
 * Figure out which route segment index a path point-index falls in.
 */
function pathIndexToSegmentIndex(pathIdx, segmentBoundaries) {
    for (let i = 0; i < segmentBoundaries.length; i++) {
        if (pathIdx < segmentBoundaries[i]) return Math.max(0, i - 1);
    }
    return segmentBoundaries.length - 1;
}

// ----- Playback -----

let simPath = [];
let simCumDists = [];
let simTotalDist = 0;
let simTravelledDist = 0;
let simSegBoundaries = [];   // cumulative point count per segment
let simAlertedSegments = new Set(); // track which segments we already alerted on

/**
 * Start the simulation playback.
 */
function startSimPlayback() {
    if (simRoute.length === 0) return;

    simPlanning = false;
    simPlaying = true;
    document.body.classList.remove('sim-planning');
    document.getElementById('simPhaseLabel').textContent = '▶ סימולציה פעילה — 40 קמ״ש';
    document.getElementById('simStartBtn').style.display = 'none';
    document.getElementById('simStopBtn').style.display = '';

    // Remove map click handler during playback and restore popups
    _removeSimMapClick();
    _restoreLanePopups();

    // Build path
    simPath = buildSimPath();
    simCumDists = buildCumulativeDistances(simPath);
    simTotalDist = simCumDists[simCumDists.length - 1] || 0;
    simTravelledDist = 0;
    simCurrentIdx = 0;
    simAlertedSegments = new Set();

    // Build segment boundaries (cumulative point count per route item)
    simSegBoundaries = [];
    let ptCount = 0;
    for (const item of simRoute) {
        if (item.type === 'segment' && item.feature && item.feature.geometry && item.feature.geometry.paths) {
            item.feature.geometry.paths.forEach(p => ptCount += p.length);
        } else if (item.type === 'waypoint') {
            ptCount += 1;
        }
        simSegBoundaries.push(ptCount);
    }

    // Enable voice for sim
    voiceEnabled = true;
    updateVoiceButton();

    // Reset cooldowns for fresh sim
    alertCooldowns = {};

    // Place car at start
    updateSimCar(simPath[0][0], simPath[0][1], 0);

    // Zoom to start
    map.setView([simPath[0][0], simPath[0][1]], 17);

    renderSimRouteList();
    updateSimStatus();

    // Start animation
    simLastTime = performance.now();
    simAnimFrame = requestAnimationFrame(simAnimationStep);
}

/**
 * Animation step — move the car along the route.
 */
function simAnimationStep(timestamp) {
    if (!simPlaying) return;

    const dt = (timestamp - simLastTime) / 1000;  // seconds
    simLastTime = timestamp;

    // Advance distance
    simTravelledDist += SIM_SPEED_MPS * dt;

    if (simTravelledDist >= simTotalDist) {
        // Reached the end
        finishSimPlayback();
        return;
    }

    // Interpolate position
    const pos = interpolateOnPath(simPath, simCumDists, simTravelledDist);

    // Figure out current segment index
    const newIdx = figureOutCurrentSegment(pos.lat, pos.lng);
    if (newIdx !== simCurrentIdx) {
        simCurrentIdx = newIdx;
        renderSimRouteList();
        scrollToActiveSegment();
    }

    // Calculate bearing from the path
    const lookAhead = interpolateOnPath(simPath, simCumDists, simTravelledDist + 5);
    const heading = bearingBetween(pos.lat, pos.lng, lookAhead.lat, lookAhead.lng);

    // Update car
    updateSimCar(pos.lat, pos.lng, heading);

    // Follow car
    map.panTo([pos.lat, pos.lng], { animate: true, duration: 0.3 });

    // Check for alerts on the current segment
    checkSimAlerts(pos.lat, pos.lng);

    // Update status
    updateSimStatus();

    simAnimFrame = requestAnimationFrame(simAnimationStep);
}

/**
 * Figure out which route segment the car is currently on.
 */
function figureOutCurrentSegment(lat, lng) {
    const pos = L.latLng(lat, lng);
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < simRoute.length; i++) {
        const item = simRoute[i];
        let d;
        if (item.type === 'segment' && item.feature && item.feature.geometry) {
            d = distanceToPolyline(pos, item.feature.geometry.paths);
        } else if (item.type === 'waypoint') {
            d = pos.distanceTo(L.latLng(item.latlng));
        } else {
            continue;
        }
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/**
 * Check and fire alerts for the current simulation position.
 */
function checkSimAlerts(lat, lng) {
    if (simCurrentIdx >= simRoute.length) return;

    const item = simRoute[simCurrentIdx];
    if (item.type !== 'segment' || !item.feature) return;  // no alerts for waypoints

    const feature = item.feature;
    const now = new Date();
    const status = getLaneStatus(feature, now);
    const attrs = feature.attributes;
    const segKey = 'sim_lane_' + attrs.oid;

    // Alert for blocked lane
    if (status.blocked && !simAlertedSegments.has(segKey)) {
        simAlertedSegments.add(segKey);
        const street = attrs.street_name || 'לא ידוע';
        speakHebrew(`זהירות! נתיב תחבורה ציבורית אסור לנסיעה ברחוב ${street}`);
        showBanner(`🚫 נתיב אסור לנסיעה — ${street}`);
    }

    // Alert for camera
    const userPos = L.latLng(lat, lng);
    for (const cam of allCameras) {
        const g = cam.geometry;
        if (!g || g.x === undefined) continue;
        const a = cam.attributes;
        if (a.status && a.status !== 'פעיל') continue;

        const mapping = cameraSegmentMap[a.OBJECTID];
        if (!mapping) continue;

        const onRoute = mapping.segments.some(seg =>
            simRoute.some(item => item.type === 'segment' && item.feature && item.feature.attributes.oid === seg.attributes.oid)
        );
        if (!onRoute) continue;

        const camPos = L.latLng(g.y, g.x);
        const dist = userPos.distanceTo(camPos);
        if (dist > 100) continue;

        const camKey = 'sim_cam_' + a.OBJECTID;
        if (simAlertedSegments.has(camKey)) continue;
        simAlertedSegments.add(camKey);

        const street = a.t_rechov1 || a.name || 'לא ידוע';
        speakHebrew(`זהירות! מצלמת אכיפת נתיב תחבורה ציבורית ברחוב ${street}, ${Math.round(dist)} מטרים`);
        showBanner(`📷 מצלמת נת"צ — ${street} (${Math.round(dist)} מ')`);
        break;
    }
}

/**
 * Update the simulator car marker on the map.
 */
function updateSimCar(lat, lng, heading) {
    const html = `<div class="car-icon" style="transform: rotate(${Math.round(heading)}deg);">🚗</div>`;
    const icon = L.divIcon({
        className: 'car-marker',
        html: html,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });

    if (!simCarMarker) {
        simCarMarker = L.marker([lat, lng], { icon, zIndexOffset: 10000 }).addTo(map);
    } else {
        simCarMarker.setLatLng([lat, lng]);
        simCarMarker.setIcon(icon);
    }
}

/**
 * Scroll the route list to show the active segment.
 */
function scrollToActiveSegment() {
    const el = document.getElementById(`sim-seg-${simCurrentIdx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Update status line at bottom of panel.
 */
function updateSimStatus() {
    const el = document.getElementById('simStatus');
    if (!el) return;

    if (simPlaying) {
        const pct = simTotalDist > 0 ? Math.round((simTravelledDist / simTotalDist) * 100) : 0;
        const remaining = Math.max(0, simTotalDist - simTravelledDist);
        const timeRemSec = remaining / SIM_SPEED_MPS;
        const mins = Math.floor(timeRemSec / 60);
        const secs = Math.round(timeRemSec % 60);
        el.textContent = `${pct}% | ${Math.round(simTotalDist)}מ׳ | נותרו ${mins}:${secs.toString().padStart(2, '0')}`;
    } else {
        // Calculate total route distance from the built path
        const tempPath = buildSimPath();
        const tempDists = buildCumulativeDistances(tempPath);
        const totalM = tempDists.length > 0 ? tempDists[tempDists.length - 1] : 0;
        const timeSec = totalM / SIM_SPEED_MPS;
        const mins = Math.floor(timeSec / 60);
        const secs = Math.round(timeSec % 60);
        el.textContent = simRoute.length > 0
            ? `${simRoute.length} מקטעים | ${Math.round(totalM)}מ׳ | ~${mins}:${secs.toString().padStart(2, '0')} דקות`
            : '';
    }
}

/**
 * Stop the playback animation.
 */
function stopSimPlayback() {
    simPlaying = false;
    if (simAnimFrame) {
        cancelAnimationFrame(simAnimFrame);
        simAnimFrame = null;
    }
    if (simCarMarker) {
        map.removeLayer(simCarMarker);
        simCarMarker = null;
    }
}

/**
 * Finish playback — show summary and return to planning.
 */
function finishSimPlayback() {
    stopSimPlayback();
    document.getElementById('simPhaseLabel').textContent = '✅ הנסיעה הסתיימה!';
    speakHebrew('הנסיעה הסתיימה');
    showBanner('✅ סימולציה הסתיימה');

    // Return to planning after a short delay
    setTimeout(() => {
        enterSimPlanning();
    }, 3000);
}

/**
 * Clear the route and reset.
 */
function clearSimRoute() {
    stopSimPlayback();
    simRoute = [];
    simCurrentIdx = 0;
    if (simHighlightLayer) {
        map.removeLayer(simHighlightLayer);
        simHighlightLayer = null;
    }
    renderSimRouteList();
    updateSimStartButton();
    updateSimStatus();
    // Re-enter planning state properly
    enterSimPlanning();
}

/**
 * Setup simulator event listeners.
 */
function setupSimulator() {
    // Simulator is desktop-only — hide on mobile/tablet
    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || ('ontouchstart' in window && window.innerWidth < 900);
    const btnSim = document.getElementById('btnSimulator');
    if (isMobile) {
        if (btnSim) btnSim.style.display = 'none';
        return;
    }

    const btnClose = document.getElementById('simClose');
    const btnStart = document.getElementById('simStartBtn');
    const btnStop = document.getElementById('simStopBtn');
    const btnClear = document.getElementById('simClearBtn');

    if (btnSim) btnSim.addEventListener('click', toggleSimulator);
    if (btnClose) btnClose.addEventListener('click', () => {
        document.getElementById('simPanel').classList.remove('open');
        exitSimulator();
    });
    if (btnStart) btnStart.addEventListener('click', startSimPlayback);
    if (btnStop) btnStop.addEventListener('click', () => {
        stopSimPlayback();
        enterSimPlanning();
    });
    if (btnClear) btnClear.addEventListener('click', clearSimRoute);
}

// ============================================================
// Main Initialization
// ============================================================

async function init() {
    // Start clock immediately
    startClockUpdates();

    // Initialize map
    initMap();

    // Setup camera toggle
    setupCameraToggle();

    // Setup driving controls (GPS, voice, driving mode)
    setupDriveControls();

    // Setup simulator
    setupSimulator();

    // Register service worker for PWA
    registerServiceWorker();

    // Fetch data from Tel Aviv GIS (lanes + cameras in parallel)
    try {
        const [lanes, cameras, junctions] = await Promise.all([
            fetchAllFeatures(),
            fetchAllCameras(),
            fetchSignalizedJunctions()
        ]);

        allRawFeatures = lanes;
        allJunctions = junctions;
        allCameras = cameras;

        // Split bus lane features at signalized junctions
        allFeatures = splitFeaturesAtJunctions(lanes, junctions);

        if (allFeatures.length === 0 && allCameras.length === 0) {
            document.querySelector('.loading-text').textContent = 'לא נמצאו נתונים';
            document.querySelector('.loading-sub').textContent = 'נסה לרענן את הדף';
            return;
        }

        // Render with current time
        const now = new Date();
        renderLanes(allFeatures, now);
        renderCameras(allCameras);

        // Build camera→segment offline index
        buildCameraSegmentIndex();

        // Build street autocomplete for sign reports
        buildStreetAutocomplete();

        // Log matching stats
        let matched = 0, unmatched = 0;
        const unmatchedStreets = new Set();
        allFeatures.forEach(f => {
            const sch = findSchedule(f);
            if (sch) { matched++; }
            else {
                unmatched++;
                if (f.attributes.street_name) unmatchedStreets.add(f.attributes.street_name);
            }
        });
        console.log(`📊 Schedule matching: ${matched} matched, ${unmatched} unmatched`);
        if (unmatchedStreets.size > 0) {
            console.log('⚠️ Unmatched streets:', [...unmatchedStreets].join(', '));
        }

        // Hide loading overlay
        document.getElementById('loadingOverlay').classList.add('hidden');

        // Auto-start GPS (blue dot always visible)
        startGps();

        // Start periodic refresh
        startStatusRefresh();

        // Sync shared reports from GitHub
        syncReports().then(() => {
            // Re-render lanes after sync (sign overrides may have changed)
            renderLanes(allFeatures, new Date());
        }).catch(e => console.warn('Initial sync failed:', e));

        // Periodic sync every 3 minutes
        setInterval(() => {
            syncReports().then(() => {
                renderLanes(allFeatures, new Date());
            }).catch(() => {});
        }, 3 * 60 * 1000);

        console.log(`✅ Loaded ${allFeatures.length} bus lanes + ${allCameras.length} cameras. Day type: ${getDayType(now)}, Hour: ${getCurrentDecimalHour(now).toFixed(2)}`);
    } catch (error) {
        console.error('Failed to initialize:', error);
        document.querySelector('.loading-text').textContent = 'שגיאה בטעינת נתונים';
        document.querySelector('.loading-sub').textContent = error.message;
    }
}

// Start the application
document.addEventListener('DOMContentLoaded', init);
