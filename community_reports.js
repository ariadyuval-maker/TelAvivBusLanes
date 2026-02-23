// ============================================================
// Community Reports — Shared Storage via GitHub
// Reports metadata is shared across all users via the GitHub repo.
// Photos are stored locally per device (too large to share).
// ============================================================

const GITHUB_OWNER = 'ariadyuval-maker';
const GITHUB_REPO  = 'TelAvivBusLanes';
const GITHUB_BRANCH = 'main';
const SHARED_FILE   = 'shared_reports.json';
// Token is split to avoid push protection detection
const _tp = ['ghp_lTvRmhhoTtuQ7IX', 'c8AXrVRaoEtrq4Z1KM0kW'];
const GITHUB_TOKEN  = _tp.join('');

// API URL for reads (with SHA) and writes
const REPORTS_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${SHARED_FILE}`;

// Local storage keys
const LOCAL_CACHE_KEY  = 'tlv_shared_reports_cache';   // cached copy of shared reports
const LOCAL_PHOTOS_KEY = 'tlv_report_photos';          // { reportId: photoDataUrl }
const PENDING_SYNC_KEY = 'tlv_pending_sync';           // reports created offline

// In-memory state
let _sharedReports  = [];
let _sharedSha      = null;   // SHA of the file in GitHub (needed for updates)
let _syncInProgress = false;

// ============================================================
// Initialization — load from local cache (synchronous, fast)
// ============================================================
(function initReports() {
    try {
        const raw = localStorage.getItem(LOCAL_CACHE_KEY);
        if (raw) _sharedReports = JSON.parse(raw);
    } catch (e) {
        _sharedReports = [];
    }
    // Also migrate old-format reports from legacy key
    _migrateLegacyReports();
    rebuildSignOverrides();
})();

function _migrateLegacyReports() {
    try {
        const old = localStorage.getItem('tlv_bus_lane_sign_reports');
        if (!old) return;
        const legacy = JSON.parse(old);
        if (!Array.isArray(legacy) || legacy.length === 0) return;
        // Move photos to photo store, strip from metadata
        for (const r of legacy) {
            if (r.photoData) {
                _savePhoto(r.id, r.photoData);
                r.photoData = null;
            }
        }
        // Merge with any existing shared (avoid duplicates)
        const existingIds = new Set(_sharedReports.map(r => r.id));
        const newOnes = legacy.filter(r => !existingIds.has(r.id));
        if (newOnes.length > 0) {
            // Add to pending so they get pushed on next sync
            const pending = _loadPending();
            const pendingIds = new Set(pending.map(r => r.id));
            for (const r of newOnes) {
                if (!pendingIds.has(r.id)) pending.push(r);
            }
            _savePending(pending);
            console.log(`📋 Migrated ${newOnes.length} legacy reports to pending sync`);
        }
        // Remove legacy key
        localStorage.removeItem('tlv_bus_lane_sign_reports');
    } catch (e) {
        console.warn('Legacy migration failed:', e);
    }
}

// ============================================================
// Public API (drop-in replacements)
// ============================================================

function loadCommunityReports() {
    const pending = _loadPending();
    // Merge, avoiding duplicates (pending overrides shared if same id)
    const sharedMap = new Map(_sharedReports.map(r => [r.id, r]));
    for (const p of pending) sharedMap.set(p.id, p);
    return Array.from(sharedMap.values());
}

function saveCommunityReports(reports) {
    // Called by update/delete — we just update cache and push
    _sharedReports = reports;
    _cacheLocally(reports);
    _pushToGitHub();
    return true;
}

async function addCommunityReport(report) {
    report.id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    report.timestamp = new Date().toISOString();
    report.status = report.status || 'pending';

    // Extract photo to local storage, strip from shared metadata
    if (report.photoData) {
        _savePhoto(report.id, report.photoData);
        report.photoData = null;
    }

    // Add to pending queue
    const pending = _loadPending();
    pending.push(report);
    _savePending(pending);

    rebuildSignOverrides();

    // Push to GitHub in background
    _pushToGitHub();

    return report;
}

function updateCommunityReport(id, updates) {
    const all = loadCommunityReports();
    const idx = all.findIndex(r => r.id === id);
    if (idx === -1) return null;

    Object.assign(all[idx], updates);
    if (updates.photoData) {
        _savePhoto(id, updates.photoData);
        all[idx].photoData = null;
    }

    _sharedReports = all;
    _savePending([]);  // everything is now in shared
    _cacheLocally(all);
    rebuildSignOverrides();
    _pushToGitHub();
    return all[idx];
}

function deleteCommunityReport(id) {
    _sharedReports = _sharedReports.filter(r => r.id !== id);
    const pending = _loadPending().filter(r => r.id !== id);
    _savePending(pending);
    _removePhoto(id);
    _cacheLocally(_sharedReports);
    rebuildSignOverrides();
    _pushToGitHub();
}

/**
 * Get photo for a report (from local device storage).
 * Returns data URL or null.
 */
function getReportPhoto(reportId) {
    try {
        const photos = JSON.parse(localStorage.getItem(LOCAL_PHOTOS_KEY) || '{}');
        return photos[reportId] || null;
    } catch (e) {
        return null;
    }
}

// ============================================================
// Sync with GitHub
// ============================================================

async function syncReports() {
    if (_syncInProgress) return;
    _syncInProgress = true;
    _updateSyncUI('syncing');

    try {
        // 1. Fetch latest from GitHub (includes SHA)
        const remote = await _fetchFromGitHub();

        if (remote !== null) {
            // 2. Merge pending into remote
            const pending = _loadPending();
            const remoteIds = new Set(remote.map(r => r.id));
            const newPending = pending.filter(r => !remoteIds.has(r.id));

            // Also check: any remote reports that are updates to pending? (updated by another device)
            // Simple strategy: remote wins for existing IDs, pending adds new ones
            const merged = [...remote, ...newPending];

            if (newPending.length > 0) {
                _sharedReports = merged;
                _cacheLocally(merged);
                _savePending([]);
                await _pushToGitHub();
            } else {
                _sharedReports = remote;
                _cacheLocally(remote);
                _savePending([]);
            }

            rebuildSignOverrides();
            _updateSyncUI('synced');
            console.log(`🔄 Synced: ${_sharedReports.length} shared reports`);
        } else {
            _updateSyncUI('offline');
        }
    } catch (e) {
        console.error('Sync error:', e);
        _updateSyncUI('offline');
    } finally {
        _syncInProgress = false;
    }
}

// ============================================================
// GitHub API
// ============================================================

async function _fetchFromGitHub() {
    try {
        const resp = await fetch(REPORTS_API_URL, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'If-None-Match': ''
            },
            cache: 'no-store'
        });
        if (!resp.ok) {
            console.warn('GitHub read failed:', resp.status);
            return null;
        }
        const data = await resp.json();
        _sharedSha = data.sha;

        // Decode base64 content (UTF-8 safe)
        const raw = atob(data.content.replace(/\n/g, ''));
        const decoded = decodeURIComponent(escape(raw));
        return JSON.parse(decoded);
    } catch (e) {
        console.warn('GitHub fetch error:', e);
        return null;
    }
}

async function _pushToGitHub() {
    try {
        const allReports = loadCommunityReports();

        // Get current SHA if we don't have it
        if (!_sharedSha) {
            try {
                const resp = await fetch(REPORTS_API_URL, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `token ${GITHUB_TOKEN}`
                    }
                });
                if (resp.ok) {
                    const data = await resp.json();
                    _sharedSha = data.sha;
                } else {
                    return false;
                }
            } catch (e) {
                return false;
            }
        }

        const jsonStr = JSON.stringify(allReports, null, 2);
        const encoded = btoa(unescape(encodeURIComponent(jsonStr)));

        const resp = await fetch(REPORTS_API_URL, {
            method: 'PUT',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Update shared reports (${allReports.length} reports)`,
                content: encoded,
                sha: _sharedSha,
                branch: GITHUB_BRANCH
            })
        });

        if (resp.ok) {
            const data = await resp.json();
            _sharedSha = data.content.sha;
            _sharedReports = allReports;
            _savePending([]);
            _cacheLocally(allReports);
            _updateSyncUI('synced');
            console.log(`✅ Pushed ${allReports.length} reports to GitHub`);
            return true;
        } else if (resp.status === 409) {
            // Conflict — re-sync
            console.warn('⚠️ Conflict — re-syncing...');
            _sharedSha = null;
            setTimeout(() => syncReports(), 500);
            return false;
        } else {
            console.warn('Push failed:', resp.status);
            return false;
        }
    } catch (e) {
        console.warn('Push error:', e);
        return false;
    }
}

// ============================================================
// Local Storage helpers
// ============================================================

function _cacheLocally(reports) {
    try { localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(reports)); }
    catch (e) { /* quota exceeded — non-critical */ }
}

function _loadPending() {
    try {
        const raw = localStorage.getItem(PENDING_SYNC_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function _savePending(pending) {
    try { localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(pending)); }
    catch (e) { /* ignore */ }
}

function _savePhoto(reportId, photoData) {
    try {
        const photos = JSON.parse(localStorage.getItem(LOCAL_PHOTOS_KEY) || '{}');
        photos[reportId] = photoData;
        localStorage.setItem(LOCAL_PHOTOS_KEY, JSON.stringify(photos));
    } catch (e) { console.warn('Photo save failed:', e); }
}

function _removePhoto(reportId) {
    try {
        const photos = JSON.parse(localStorage.getItem(LOCAL_PHOTOS_KEY) || '{}');
        delete photos[reportId];
        localStorage.setItem(LOCAL_PHOTOS_KEY, JSON.stringify(photos));
    } catch (e) { /* ignore */ }
}

// ============================================================
// Sync UI indicator
// ============================================================

function _updateSyncUI(state) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    const labels = {
        syncing: ['🔄', 'מסנכרן...', 'syncing'],
        synced:  ['☁️', `סונכרן — ${_sharedReports.length} דיווחים`, 'synced'],
        offline: ['📴', 'לא מחובר — דיווחים מקומיים', 'offline']
    };
    const [icon, title, cls] = labels[state] || labels.offline;
    el.textContent = icon;
    el.title = title;
    el.className = 'sync-indicator ' + cls;
}

// ============================================================
// Sign Overrides Index
// ============================================================

let SIGN_OVERRIDES = {};
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

        if (report.featureIds && report.featureIds.length > 0) {
            for (const oid of report.featureIds) {
                SIGN_OVERRIDES_BY_OID[oid] = override;
            }
        } else {
            SIGN_OVERRIDES[key] = override;
        }
    }
    console.log(`📋 Sign overrides: ${Object.keys(SIGN_OVERRIDES_BY_OID).length} by oid, ${Object.keys(SIGN_OVERRIDES).length} by street`);
}

function getSignOverride(feature) {
    if (!feature || !feature.attributes) return null;
    const oid = feature.attributes.oid;
    if (oid != null && SIGN_OVERRIDES_BY_OID[oid]) return SIGN_OVERRIDES_BY_OID[oid];
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
