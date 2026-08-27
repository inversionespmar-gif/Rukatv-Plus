// RukaTv - Xtream Codes Addon Logic
// Handles connection to XC servers and generates Stremio-compatible addon data

const STORAGE_KEY = 'rukatv_xtream_sources';
const { saveSourceAsync } = require('./xtreamStorage');

/**
 * Load all saved XC sources from localStorage
 */
function loadSources() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_e) {
        return [];
    }
}

/**
 * Save a new XC source to localStorage
 */
function saveSource(source) {
    const sources = loadSources();
    const existing = sources.findIndex((s) => s.id === source.id);
    if (existing >= 0) {
        sources[existing] = source;
    } else {
        sources.push(source);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
}

/**
 * Remove an XC source by ID
 */
function removeSource(id) {
    const sources = loadSources().filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
}

/**
 * Normalize the server URL (remove trailing slashes, ensure no path)
 */
function normalizeServer(server) {
    let url = server.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'http://' + url;
    }
    // Remove trailing slash
    url = url.replace(/\/$/, '');
    return url;
}

/**
 * Build the XC player API base URL
 */
function buildApiUrl(server, username, password) {
    return `${server}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        return await response.json();
    } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') throw new Error('Tiempo de conexión agotado. Verifica el servidor.');
        throw e;
    }
}

/**
 * Test XC credentials and get user info
 */
async function testConnection(server, username, password) {
    const normalizedServer = normalizeServer(server);
    const apiUrl = buildApiUrl(normalizedServer, username, password);

    let data;
    try {
        data = await fetchWithTimeout(apiUrl + '&action=get_user_info', 8000);
    } catch (_e) {
        // Ignore error and try base URL
    }

    if (!data || !data.user_info) {
        data = await fetchWithTimeout(apiUrl, 8000);
    }

    if (!data || !data.user_info) {
        throw new Error('Respuesta inválida del servidor. Verifica las credenciales.');
    }

    if (data.user_info.auth === 0 || data.user_info.auth === '0') {
        throw new Error('Usuario o contraseña incorrectos.');
    }

    return {
        server: normalizedServer,
        username,
        password,
        userInfo: data.user_info,
        serverInfo: data.server_info || {},
    };
}

/**
 * Fetch live categories from XC server
 */
async function getLiveCategories(server, username, password) {
    const apiUrl = buildApiUrl(server, username, password);
    return fetchWithTimeout(apiUrl + '&action=get_live_categories');
}

/**
 * Fetch VOD categories from XC server
 */
async function getVodCategories(server, username, password) {
    const apiUrl = buildApiUrl(server, username, password);
    return fetchWithTimeout(apiUrl + '&action=get_vod_categories');
}

/**
 * Fetch series categories from XC server
 */
async function getSeriesCategories(server, username, password) {
    const apiUrl = buildApiUrl(server, username, password);
    return fetchWithTimeout(apiUrl + '&action=get_series_categories');
}

/**
 * Fetch live streams for a category
 */
async function getLiveStreams(server, username, password, categoryId = '') {
    const apiUrl = buildApiUrl(server, username, password);
    const catParam = categoryId ? `&category_id=${categoryId}` : '';
    return fetchWithTimeout(apiUrl + '&action=get_live_streams' + catParam);
}

/**
 * Fetch VOD streams for a category
 */
async function getVodStreams(server, username, password, categoryId = '') {
    const apiUrl = buildApiUrl(server, username, password);
    const catParam = categoryId ? `&category_id=${categoryId}` : '';
    return fetchWithTimeout(apiUrl + '&action=get_vod_streams' + catParam);
}

/**
 * Fetch series for a category
 */
async function getSeries(server, username, password, categoryId = '') {
    const apiUrl = buildApiUrl(server, username, password);
    const catParam = categoryId ? `&category_id=${categoryId}` : '';
    return fetchWithTimeout(apiUrl + '&action=get_series' + catParam);
}

/**
 * Build stream URL for a live channel
 */
function buildLiveStreamUrl(server, username, password, streamId, ext = 'ts') {
    return `${server}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
}

/**
 * Build stream URL for VOD
 */
function buildVodStreamUrl(server, username, password, streamId, ext = 'mp4') {
    return `${server}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
}

/**
 * Build a unique source ID from credentials
 */
function buildSourceId(server, username) {
    const clean = server.replace(/https?:\/\//, '').replace(/[^a-z0-9]/gi, '_');
    return `xc_${clean}_${username}`.toLowerCase();
}

/**
 * Generate a Stremio-compatible addon manifest for this XC source
 */
function generateManifest(source) {
    const { id, name, server, username, password } = source;
    return {
        id: id,
        version: '1.0.0',
        name: name || `IPTV XC: ${username}`,
        description: `Servidor Xtream Codes: ${server}`,
        logo: null,
        background: null,
        types: ['tv', 'movie', 'series'],
        catalogs: [
            {
                type: 'tv',
                id: `${id}_live`,
                name: 'Canales en Vivo',
                extra: [
                    { name: 'search', isRequired: false },
                    { name: 'genre', isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
            },
            {
                type: 'movie',
                id: `${id}_vod`,
                name: 'Películas (VOD)',
                extra: [
                    { name: 'search', isRequired: false },
                    { name: 'genre', isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
            },
            {
                type: 'series',
                id: `${id}_series`,
                name: 'Series',
                extra: [
                    { name: 'search', isRequired: false },
                    { name: 'genre', isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
            },
        ],
        resources: ['catalog', 'meta', 'stream'],
        idPrefixes: ['xc_'],
        behaviorHints: {
            configurable: false,
            configurationRequired: false,
        },
        // Store credentials for later use
        _xcCredentials: { server, username, password },
    };
}

/**
 * Connect to XC server and install the addon
 * Returns the manifest object if successful
 */
async function connectAndInstall(server, username, password, onProgress) {
    const normalizedServer = normalizeServer(server);

    if (onProgress) onProgress('Verificando credenciales...');
    const connectionResult = await testConnection(normalizedServer, username, password);

    const sourceId = buildSourceId(normalizedServer, username);
    const serverName = connectionResult.serverInfo.url || normalizedServer;
    const source = {
        id: sourceId,
        name: `IPTV: ${username}@${serverName}`,
        server: normalizedServer,
        username,
        password,
        installedAt: Date.now(),
    };

    if (onProgress) onProgress('Guardando configuración...');
    await saveSourceAsync(source);

    const manifest = generateManifest(source);
    const transportUrl = `https://xtream.internal/${sourceId}/manifest.json`;
    const addonDescriptor = {
        transportUrl,
        manifest,
        flags: { official: false, protected: false }
    };

    return { manifest, source, transportUrl, addonDescriptor, connectionResult };
}

/**
 * Sync saved XC sources to Stremio Core profile addons
 * Dispatches InstallAddon for each source so Stremio Core displays catalogs on Home (Board) & Discover screens
 */
async function syncXtreamAddonsToCore(core) {
    if (!core || !core.transport) return;
    try {
        const { loadSourcesAsync } = require('./xtreamStorage');
        const sources = await loadSourcesAsync();
        for (const source of sources) {
            const manifest = generateManifest(source);
            const transportUrl = `https://xtream.internal/${source.id}/manifest.json`;
            const addonDescriptor = {
                transportUrl,
                manifest,
                flags: { official: false, protected: false }
            };
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'InstallAddon',
                    args: addonDescriptor
                }
            });
        }
    } catch (e) {
        console.error('Failed to sync Xtream addons to core:', e);
    }
}

module.exports = {
    loadSources,
    saveSource,
    removeSource,
    normalizeServer,
    buildSourceId,
    buildApiUrl,
    testConnection,
    getLiveCategories,
    getVodCategories,
    getSeriesCategories,
    getLiveStreams,
    getVodStreams,
    getSeries,
    buildLiveStreamUrl,
    buildVodStreamUrl,
    generateManifest,
    connectAndInstall,
    syncXtreamAddonsToCore,
};
