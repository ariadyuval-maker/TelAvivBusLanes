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
let allCameras = [];
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
        return { blocked: false, reason: 'נתצ לא פעיל', category: 'open', schedule: null };
    }

    // Find schedule from bus_lane_hours.js
    const schedule = findSchedule(feature);

    if (!schedule) {
        // No schedule data found for this feature → unknown
        return { blocked: true, reason: 'לא נמצא מידע על שעות – ייתכן שחסום', category: 'unknown', schedule: null };
    }

    // 24/7 permanent bus lane
    if (schedule.allWeek) {
        return { blocked: true, reason: 'נתצ קבוע – חסום תמיד (24/7)', category: 'blocked', schedule };
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
            schedule
        };
    }

    // Check each time range
    for (const [start, end] of ranges) {
        if (isInTimeRange(currentHr, start, end)) {
            return {
                blocked: true,
                reason: `חסום כעת: ${formatHour(start)} - ${formatHour(end)}`,
                category: 'blocked',
                schedule
            };
        }
    }

    // Outside all operating hours → open
    const rangeStr = ranges.map(r => `${formatHour(r[0])}-${formatHour(r[1])}`).join(', ');
    return {
        blocked: false,
        reason: `פתוח כעת (הגבלה: ${rangeStr})`,
        category: 'open',
        schedule
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

    // Base tile layer - OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | נתונים: עיריית תל אביב-יפו',
        maxZoom: 19
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

            polyline.bindPopup(createPopupContent(feature, status), {
                maxWidth: 320,
                className: 'lane-popup-container'
            });

            laneLayerGroup.addLayer(polyline);
        });
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
let lastAlertedStreets = new Set(); // prevent repeat alerts within cooldown
let alertCooldowns = {}; // street → timestamp of last alert
const ALERT_COOLDOWN_MS = 120000; // 2 minutes between repeated alerts for same street
const PROXIMITY_METERS = 200; // alert when within 200m of a blocked lane

// ------ Driving Mode State ------
let drivingMode = false;

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
}

/**
 * Handle GPS position update
 */
function onGpsPosition(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;
    userLatLng = L.latLng(lat, lng);

    // Update / create user marker
    if (!userMarker) {
        const icon = L.divIcon({
            className: 'user-marker',
            html: '<div class="user-dot"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        userMarker = L.marker(userLatLng, { icon, zIndexOffset: 9999 }).addTo(map);
    } else {
        userMarker.setLatLng(userLatLng);
    }

    // Update accuracy circle
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

    // Auto-follow
    if (followMode) {
        map.setView(userLatLng, Math.max(map.getZoom(), 16));
    }

    // Check proximity to blocked lanes and cameras
    if (voiceEnabled) {
        if (allFeatures.length > 0) checkProximity(userLatLng);
        if (allCameras.length > 0) checkCameraProximity(userLatLng);
    }
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
 * Check if user is near any blocked bus lane and trigger alerts
 */
function checkProximity(userPos) {
    const now = new Date();
    const currentTime = Date.now();
    const nearbyBlocked = [];

    for (const feature of allFeatures) {
        if (!feature.geometry || !feature.geometry.paths) continue;

        const status = getLaneStatus(feature, now);
        if (!status.blocked) continue;

        const dist = distanceToPolyline(userPos, feature.geometry.paths);
        if (dist <= PROXIMITY_METERS) {
            const streetName = feature.attributes.street_name || 'לא ידוע';
            const key = streetName;

            // Check cooldown
            if (alertCooldowns[key] && (currentTime - alertCooldowns[key]) < ALERT_COOLDOWN_MS) {
                continue;
            }

            nearbyBlocked.push({ streetName, dist: Math.round(dist), status });
            alertCooldowns[key] = currentTime;
        }
    }

    if (nearbyBlocked.length > 0) {
        // Sort by distance
        nearbyBlocked.sort((a, b) => a.dist - b.dist);
        const closest = nearbyBlocked[0];

        // Voice alert
        speakAlert(closest.streetName, closest.dist);

        // Visual banner
        showBanner(`🚫 נתצ חסום — ${closest.streetName} (${closest.dist} מ')`);
    }
}

/**
 * Check if user is near any active enforcement camera and trigger alert
 */
function checkCameraProximity(userPos) {
    const currentTime = Date.now();
    const now = new Date();
    const nearbycameras = [];

    for (const cam of allCameras) {
        const g = cam.geometry;
        if (!g || g.x === undefined || g.y === undefined) continue;

        // Only warn for active cameras
        const a = cam.attributes;
        if (a.status && a.status !== 'פעיל') continue;

        const camPos = L.latLng(g.y, g.x);
        const dist = userPos.distanceTo(camPos);

        if (dist <= PROXIMITY_METERS) {
            const key = 'cam_' + (a.ms_atar || a.name || `${g.y},${g.x}`);

            // Check cooldown
            if (alertCooldowns[key] && (currentTime - alertCooldowns[key]) < ALERT_COOLDOWN_MS) {
                continue;
            }

            const streetName = a.t_rechov1 || a.name || 'לא ידוע';
            nearbycameras.push({ streetName, dist: Math.round(dist), key });
            alertCooldowns[key] = currentTime;
        }
    }

    if (nearbycameras.length > 0) {
        nearbycameras.sort((a, b) => a.dist - b.dist);
        const closest = nearbycameras[0];

        // Voice alert
        speakCameraAlert(closest.streetName, closest.dist);

        // Visual banner
        showBanner(`📷 מצלמת נת"צ — ${closest.streetName} (${closest.dist} מ')`);
    }
}

/**
 * Speak a camera proximity alert in Hebrew
 */
function speakCameraAlert(streetName, distMeters) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const text = `זהירות! מצלמת אכיפה ברחוב ${streetName}, ${distMeters} מטרים`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'he-IL';
    utterance.rate = 1.1;
    utterance.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const hebrewVoice = voices.find(v => v.lang.startsWith('he'));
    if (hebrewVoice) utterance.voice = hebrewVoice;

    window.speechSynthesis.speak(utterance);
}

/**
 * Speak a Hebrew voice alert
 */
function speakAlert(streetName, distMeters) {
    if (!('speechSynthesis' in window)) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const text = `זהירות! נתיב תחבורה ציבורית חסום ברחוב ${streetName}, ${distMeters} מטרים`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'he-IL';
    utterance.rate = 1.1;
    utterance.volume = 1.0;

    // Try to find Hebrew voice
    const voices = window.speechSynthesis.getVoices();
    const hebrewVoice = voices.find(v => v.lang.startsWith('he'));
    if (hebrewVoice) utterance.voice = hebrewVoice;

    window.speechSynthesis.speak(utterance);
}

/**
 * Show a visual alert banner (auto-hides after 5s)
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

        // Request wake lock to prevent screen from sleeping
        requestWakeLock();
    } else {
        releaseWakeLock();
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
    const btnGps = document.getElementById('btnGps');
    const btnVoice = document.getElementById('btnVoice');
    const btnDrive = document.getElementById('btnDrive');

    if (btnGps) btnGps.addEventListener('click', toggleGps);
    if (btnVoice) btnVoice.addEventListener('click', toggleVoice);
    if (btnDrive) btnDrive.addEventListener('click', toggleDrivingMode);

    // Stop auto-follow when user manually pans
    map.on('dragstart', () => {
        if (followMode) followMode = false;
    });

    // Double-tap GPS button to re-center
    if (btnGps) {
        btnGps.addEventListener('dblclick', () => {
            if (gpsActive && userLatLng) {
                followMode = true;
                map.setView(userLatLng, 17);
            }
        });
    }

    // Preload voices
    if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
}

// ============================================================
// Service Worker Registration
// ============================================================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('✅ Service Worker registered'))
            .catch(err => console.warn('SW registration failed:', err));
    }
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

    // Register service worker for PWA
    registerServiceWorker();

    // Fetch data from Tel Aviv GIS (lanes + cameras in parallel)
    try {
        const [lanes, cameras] = await Promise.all([
            fetchAllFeatures(),
            fetchAllCameras()
        ]);

        allFeatures = lanes;
        allCameras = cameras;

        if (allFeatures.length === 0 && allCameras.length === 0) {
            document.querySelector('.loading-text').textContent = 'לא נמצאו נתונים';
            document.querySelector('.loading-sub').textContent = 'נסה לרענן את הדף';
            return;
        }

        // Render with current time
        const now = new Date();
        renderLanes(allFeatures, now);
        renderCameras(allCameras);

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

        // Start periodic refresh
        startStatusRefresh();

        console.log(`✅ Loaded ${allFeatures.length} bus lanes + ${allCameras.length} cameras. Day type: ${getDayType(now)}, Hour: ${getCurrentDecimalHour(now).toFixed(2)}`);
    } catch (error) {
        console.error('Failed to initialize:', error);
        document.querySelector('.loading-text').textContent = 'שגיאה בטעינת נתונים';
        document.querySelector('.loading-sub').textContent = error.message;
    }
}

// Start the application
document.addEventListener('DOMContentLoaded', init);
