// ============================================================
// Community Sign Reports - Tel Aviv Bus Lanes
// Crowdsourced sign photo data with GPS locations
// ============================================================

const REPORTS_STORAGE_KEY = 'tlv_bus_lane_sign_reports';

function loadCommunityReports() {
    try {
        const raw = localStorage.getItem(REPORTS_STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch (e) {
        console.warn('Failed to load community reports:', e);
        return [];
    }
}

function saveCommunityReports(reports) {
    try {
        localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
        return true;
    } catch (e) {
        console.error('❌ Failed to save community reports:', e);
        return false;
    }
}

function addCommunityReport(report) {
    const reports = loadCommunityReports();
    report.id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    report.timestamp = new Date().toISOString();
    report.status = report.status || 'pending';
    reports.push(report);
    const ok = saveCommunityReports(reports);
    if (!ok) {
        console.error('❌ Failed to save report — localStorage quota exceeded?');
        return null;
    }
    rebuildSignOverrides();
    return report;
}

function updateCommunityReport(id, updates) {
    const reports = loadCommunityReports();
    const idx = reports.findIndex(r => r.id === id);
    if (idx === -1) return null;
    Object.assign(reports[idx], updates);
    saveCommunityReports(reports);
    rebuildSignOverrides();
    return reports[idx];
}

function deleteCommunityReport(id) {
    let reports = loadCommunityReports();
    reports = reports.filter(r => r.id !== id);
    saveCommunityReports(reports);
    rebuildSignOverrides();
}

// ============================================================
// Sign Overrides Index
// ============================================================

let SIGN_OVERRIDES = {};
// Overrides keyed by oid for segment-specific matching
let SIGN_OVERRIDES_BY_OID = {};

function rebuildSignOverrides() {
    SIGN_OVERRIDES = {};
    SIGN_OVERRIDES_BY_OID = {};
    const reports = loadCommunityReports();
    const decoded = reports
        .filter(r => r.status === 'decoded' && r.decodedHours)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    for (const report of decoded) {
        const key = report.street ? report.street.trim() : '';
        if (!key) continue;

        const override = {
            report: report,
            hours: report.decodedHours,
            street: report.street,
            timestamp: report.timestamp,
            featureIds: report.featureIds || null
        };

        // If report has specific featureIds (new format), key by each oid
        if (report.featureIds && report.featureIds.length > 0) {
            for (const oid of report.featureIds) {
                SIGN_OVERRIDES_BY_OID[oid] = override;
            }
        } else {
            // Legacy: key by street name (applies to all segments of that street)
            SIGN_OVERRIDES[key] = override;
        }
    }
    console.log(`📋 Sign overrides: ${Object.keys(SIGN_OVERRIDES_BY_OID).length} by oid, ${Object.keys(SIGN_OVERRIDES).length} by street`);
}

function getSignOverride(feature) {
    if (!feature || !feature.attributes) return null;

    // First try segment-specific override by oid
    const oid = feature.attributes.oid;
    if (oid != null && SIGN_OVERRIDES_BY_OID[oid]) {
        return SIGN_OVERRIDES_BY_OID[oid];
    }

    // Fallback: legacy street-name-based override (for old reports without featureIds)
    const street = feature.attributes.street_name;
    if (!street) return null;
    if (SIGN_OVERRIDES[street]) return SIGN_OVERRIDES[street];
    const norm = typeof normalizeStreet === 'function' ? normalizeStreet(street) : street.trim();
    for (const key of Object.keys(SIGN_OVERRIDES)) {
        const normKey = typeof normalizeStreet === 'function' ? normalizeStreet(key) : key.trim();
        if (normKey === norm) return SIGN_OVERRIDES[key];
    }
    if (typeof STREET_ALIASES !== 'undefined') {
        const aliased = STREET_ALIASES[norm] || norm;
        for (const key of Object.keys(SIGN_OVERRIDES)) {
            const normKey = typeof normalizeStreet === 'function' ? normalizeStreet(key) : key.trim();
            if (normKey === aliased) return SIGN_OVERRIDES[key];
        }
    }
    return null;
}

function getReportsForStreet(streetName) {
    if (!streetName) return [];
    const reports = loadCommunityReports();
    const norm = streetName.trim();
    return reports.filter(r => {
        if (!r.street) return false;
        return r.street.trim() === norm || r.street.includes(norm) || norm.includes(r.street);
    });
}

// ============================================================
// EXIF GPS Extraction (pure browser, no external library)
// ============================================================

function extractExifGps(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const view = new DataView(e.target.result);
                resolve(parseExifGps(view));
            } catch (err) {
                console.warn('EXIF parse error:', err);
                resolve(null);
            }
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file);
    });
}

function parseExifGps(view) {
    if (view.getUint16(0) !== 0xFFD8) return null;
    let offset = 2;
    while (offset < view.byteLength - 2) {
        const marker = view.getUint16(offset);
        offset += 2;
        if (marker === 0xFFE1) {
            const segLen = view.getUint16(offset);
            if (view.getUint32(offset + 2) === 0x45786966 && view.getUint16(offset + 6) === 0x0000) {
                return parseExifIfd(view, offset + 8);
            }
            offset += segLen;
        } else if ((marker & 0xFF00) === 0xFF00) {
            if (marker === 0xFFDA) break;
            offset += view.getUint16(offset);
        } else {
            break;
        }
    }
    return null;
}

function parseExifIfd(view, tiffStart) {
    const le = view.getUint16(tiffStart) === 0x4949;
    function getU16(off) { return view.getUint16(tiffStart + off, le); }
    function getU32(off) { return view.getUint32(tiffStart + off, le); }
    if (getU16(2) !== 42) return null;
    const ifdOffset = getU32(4);
    let gpsIfdOffset = null;
    const numEntries = getU16(ifdOffset);
    for (let i = 0; i < numEntries; i++) {
        const entryOff = ifdOffset + 2 + i * 12;
        if (getU16(entryOff) === 0x8825) {
            gpsIfdOffset = getU32(entryOff + 8);
            break;
        }
    }
    if (gpsIfdOffset === null) return null;
    const gpsEntries = getU16(gpsIfdOffset);
    let latRef = null, lngRef = null, latValues = null, lngValues = null;
    for (let i = 0; i < gpsEntries; i++) {
        const entryOff = gpsIfdOffset + 2 + i * 12;
        const tag = getU16(entryOff);
        const type = getU16(entryOff + 2);
        const count = getU32(entryOff + 4);
        const valueOff = getU32(entryOff + 8);
        if (tag === 1) latRef = String.fromCharCode(view.getUint8(tiffStart + entryOff + 8));
        else if (tag === 2 && type === 5 && count === 3) latValues = readRationals(view, tiffStart + valueOff, 3, le);
        else if (tag === 3) lngRef = String.fromCharCode(view.getUint8(tiffStart + entryOff + 8));
        else if (tag === 4 && type === 5 && count === 3) lngValues = readRationals(view, tiffStart + valueOff, 3, le);
    }
    if (!latValues || !lngValues) return null;
    let lat = latValues[0] + latValues[1] / 60 + latValues[2] / 3600;
    let lng = lngValues[0] + lngValues[1] / 60 + lngValues[2] / 3600;
    if (latRef === 'S') lat = -lat;
    if (lngRef === 'W') lng = -lng;
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
}

function readRationals(view, offset, count, le) {
    const result = [];
    for (let i = 0; i < count; i++) {
        const num = view.getUint32(offset + i * 8, le);
        const den = view.getUint32(offset + i * 8 + 4, le);
        result.push(den === 0 ? 0 : num / den);
    }
    return result;
}

rebuildSignOverrides();
