// RukaTv - Xtream Codes Fetch Interceptor & Addon Protocol Handler
// Intercepts browser fetch requests to https://xtream.internal/* and serves Stremio addon responses

const { loadSourcesAsync } = require('./xtreamStorage');
const { resolveStreams, mediaType } = require('./xtreamStreams');

// In-memory cache for catalog & category data to keep browsing ultra-fast
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes — keeps large catalogs (2000+ items) in memory
const pendingRequests = new Map();
const API_TIMEOUT = 30000;

const normalizeSearch = (value) => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

function getCached(key) {
    const item = cache.get(key);
    if (item && (Date.now() - item.time < CACHE_TTL)) {
        return item.data;
    }
    return null;
}

function setCache(key, data) {
    cache.set(key, { time: Date.now(), data });
}

/**
 * Only intercept the virtual addon API, in both the main window and core worker.
 * Media and proxy bodies use the browser's original networking unchanged.
 */
function setupXtreamInterceptor(scope = globalThis) {
    if (!scope.fetch || scope.fetch.xtreamInterceptor) return;
    const originalFetch = scope.fetch;
    const interceptedFetch = async function (resource, options) {
        let url;
        try {
            const input = typeof resource === 'string' || resource instanceof URL ? resource : resource.url;
            url = new URL(input, scope.location && scope.location.href);
        } catch (_e) {
            return originalFetch.call(this, resource, options);
        }
        if (url.hostname !== 'xtream.internal') {
            const response = await originalFetch.call(this, resource, options);
            const method = (options?.method || resource?.method || 'GET').toUpperCase();
            const type = method === 'HEAD' && response.ok && mediaType(response.headers.get('content-type'));
            if (!type || type === response.headers.get('content-type')) return response;
            // The original player requires a canonical HLS MIME. Normalize only
            // HEAD responses for media belonging to an installed Xtream source.
            // Do not use proxyHeaders: the core interprets it as a proxy request.
            try {
                const sources = await loadSourcesAsync();
                const isXtreamMedia = sources.some((source) => ['live', 'movie', 'series'].some((kind) => {
                    const base = new URL(`${source.server.replace(/\/+$/, '')}/${kind}/${encodeURIComponent(source.username)}/${encodeURIComponent(source.password)}/`);
                    return url.origin === base.origin && url.pathname.startsWith(base.pathname);
                }));
                if (!isXtreamMedia) return response;
                const headers = new Headers(response.headers);
                headers.set('content-type', type);
                return new Response(null, { status: response.status, statusText: response.statusText, headers });
            } catch (_e) {
                return response;
            }
        }
        try {
            return await handleXtreamRequest(url.href);
        } catch (_err) {
            return createJsonResponse({ err: 'No se pudo obtener el contenido del servidor Xtream.' }, 502);
        }
    };
    interceptedFetch.xtreamInterceptor = true;
    scope.fetch = interceptedFetch;
}

/**
 * Handle requests to https://xtream.internal/:sourceId/...
 */
async function handleXtreamRequest(urlStr) {
    const parsed = new URL(urlStr);
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    // Path structure: /:sourceId/:resource/:type/:id.json or /:sourceId/manifest.json
    const sourceId = pathParts[0];
    const resource = pathParts[1]; // manifest.json | catalog | meta | stream

    const sources = await loadSourcesAsync();
    const source = sources.find((s) => s.id === sourceId);

    if (!source && resource !== 'manifest.json') {
        return createJsonResponse({ metas: [], err: 'Source not found' }, 404);
    }

    if (resource === 'manifest.json' || !resource) {
        return await handleManifest(source, sourceId);
    }

    const type = pathParts[2]; // tv | movie | series
    let rawId = '';

    // Extract extra params if present (e.g. search=avatar or genre=Paraguay or skip=100)
    let genre = parsed.searchParams.get('genre') || '';
    let search = parsed.searchParams.get('search') || '';
    let skip = parseInt(parsed.searchParams.get('skip') || '0', 10);

    rawId = decodeURIComponent((pathParts[3] || '').replace(/\.json$/, ''));
    // Split parameters before decoding so encoded '&', '=' and '+' stay in the search term.
    for (const part of pathParts.slice(4)) {
        const extra = new URLSearchParams(part.replace(/\.json$/, ''));
        if (extra.has('genre')) genre = extra.get('genre');
        if (extra.has('search')) search = extra.get('search');
        if (extra.has('skip')) skip = parseInt(extra.get('skip'), 10);
    }
    skip = Number.isFinite(skip) && skip >= 0 ? skip : 0;

    if (resource === 'catalog') {
        return await handleCatalog(source, type, rawId, genre, skip, search);
    } else if (resource === 'meta') {
        if (!rawId.startsWith(`xc_${source.id}_`)) return createJsonResponse({ meta: null });
        return await handleMeta(source, type, rawId);
    } else if (resource === 'stream') {
        // Older installed manifests advertise the broad xc_ prefix. Do not answer
        // requests belonging to another source, even before its manifest updates.
        if (!rawId.startsWith(`xc_${source.id}_`)) return createJsonResponse({ streams: [] });
        return await handleStream(source, type, rawId);
    }

    return createJsonResponse({ err: 'Unknown resource' }, 404);
}

/**
 * Serve manifest.json with dynamic categories for genres
 */
async function handleManifest(source, sourceId) {
    const s = source || { id: sourceId, name: 'IPTV Xtream' };
    let liveGenres = [];
    let vodGenres = [];
    let seriesGenres = [];

    if (s.server && s.username && s.password) {
        try {
            const [liveCats, vodCats, seriesCats] = await Promise.all([
                fetchApiCached(s.server, s.username, s.password, 'get_live_categories').catch(() => []),
                fetchApiCached(s.server, s.username, s.password, 'get_vod_categories').catch(() => []),
                fetchApiCached(s.server, s.username, s.password, 'get_series_categories').catch(() => [])
            ]);

            if (Array.isArray(liveCats)) {
                liveGenres = liveCats.map((c) => c.category_name).filter(Boolean);
            }
            if (Array.isArray(vodCats)) {
                vodGenres = vodCats.map((c) => c.category_name).filter(Boolean);
            }
            if (Array.isArray(seriesCats)) {
                seriesGenres = seriesCats.map((c) => c.category_name).filter(Boolean);
            }
        } catch (_e) {
            // Ignore error if server categories fail
        }
    }

    const manifest = {
        id: s.id,
        version: '1.0.1',
        name: s.name || 'IPTV Xtream',
        description: `Servidor Xtream Codes IPTV: ${s.server || ''}`,
        logo: 'https://images.rukautv.com/iptv_icon.png',
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv', 'movie', 'series'],
        catalogs: [
            {
                type: 'tv',
                id: `${s.id}_live`,
                name: 'Canales en Vivo',
                extra: [
                    { name: 'search', isRequired: false },
                    { name: 'genre', options: liveGenres.length > 0 ? liveGenres : undefined, isRequired: false },
                    { name: 'skip', isRequired: false }
                ]
            },
            {
                type: 'movie',
                id: `${s.id}_vod`,
                name: 'Películas VOD',
                extra: [
                    { name: 'search', isRequired: false },
                    { name: 'genre', options: vodGenres.length > 0 ? vodGenres : undefined, isRequired: false },
                    { name: 'skip', isRequired: false }
                ]
            },
            {
                type: 'series',
                id: `${s.id}_series`,
                name: 'Series',
                extra: [
                    { name: 'search', isRequired: false },
                    { name: 'genre', options: seriesGenres.length > 0 ? seriesGenres : undefined, isRequired: false },
                    { name: 'skip', isRequired: false }
                ]
            }
        ],
        idPrefixes: [`xc_${s.id}_`]
    };
    return createJsonResponse(manifest);
}

function cleanImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    let clean = url.trim();
    if (clean.length === 0) return null;
    if (clean.startsWith('//')) return 'https:' + clean;
    if (clean.startsWith('/')) return 'https://image.tmdb.org/t/p/w500' + clean;
    if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
    return null;
}

/**
 * Serve catalog requests
 */
async function handleCatalog(source, type, catalogId, genre, skip = 0, searchQuery = '') {
    const { server, username, password } = source;
    const PAGE_SIZE = 300; // items per page
    const cacheKey = `${source.id}_${type}_${genre}_${searchQuery}_${skip}`;
    const cachedResult = getCached(cacheKey);
    if (cachedResult) {
        return createJsonResponse(cachedResult);
    }

    let metas = [];
    let hasMore = false;
    const q = normalizeSearch(searchQuery);

    if (type === 'tv') {
        const liveStreams = await fetchLiveStreamsCached(server, username, password);
        let filtered = liveStreams;
        if (genre) {
            filtered = filtered.filter((item) => String(item.category_id) === String(genre) || item.category_name === genre);
        }
        if (q) {
            filtered = filtered.filter((item) => normalizeSearch(item.name).includes(q));
        }
        hasMore = filtered.length > skip + PAGE_SIZE;
        const pageItems = filtered.slice(skip, skip + PAGE_SIZE);
        metas = pageItems.map((item) => ({
            id: `xc_${source.id}_live_${item.stream_id}`,
            type: 'tv',
            name: item.name || 'Canal Live',
            poster: cleanImageUrl(item.stream_icon),
            posterShape: 'square',
            genres: [item.category_name || item.category_id || 'Live TV']
        }));
    } else if (type === 'movie') {
        const vodStreams = await fetchVodStreamsCached(server, username, password);
        let filtered = vodStreams;
        if (genre) {
            filtered = filtered.filter((item) => String(item.category_id) === String(genre) || item.category_name === genre);
        }
        if (q) {
            filtered = filtered.filter((item) => normalizeSearch(item.name).includes(q));
        }
        hasMore = filtered.length > skip + PAGE_SIZE;
        const pageItems = filtered.slice(skip, skip + PAGE_SIZE);
        metas = pageItems.map((item) => ({
            id: `xc_${source.id}_vod_${item.stream_id}`,
            type: 'movie',
            name: item.name || 'Película',
            poster: cleanImageUrl(item.poster || item.stream_icon),
            posterShape: 'poster',
            genres: [item.category_name || item.category_id || 'Películas'],
            description: item.plot || ''
        }));
    } else if (type === 'series') {
        const seriesList = await fetchSeriesCached(server, username, password);
        let filtered = seriesList;
        if (genre) {
            filtered = filtered.filter((item) => String(item.category_id) === String(genre) || item.category_name === genre);
        }
        if (q) {
            filtered = filtered.filter((item) => normalizeSearch(item.name).includes(q));
        }
        hasMore = filtered.length > skip + PAGE_SIZE;
        const pageItems = filtered.slice(skip, skip + PAGE_SIZE);
        metas = pageItems.map((item) => ({
            id: `xc_${source.id}_series_${item.series_id}`,
            type: 'series',
            name: item.name || 'Serie',
            poster: cleanImageUrl(item.cover || item.poster),
            posterShape: 'poster',
            genres: [item.category_name || item.category_id || 'Series'],
            description: item.plot || ''
        }));
    }

    const result = { metas, hasMore };
    setCache(cacheKey, result);
    return createJsonResponse(result);
}

/**
 * Serve meta details requests
 */
async function handleMeta(source, type, id) {
    const { server, username, password } = source;

    if (id.includes('_live_')) {
        const streamId = id.split('_live_')[1];
        const liveStreams = await fetchLiveStreamsCached(server, username, password);
        const item = liveStreams.find((s) => String(s.stream_id) === String(streamId)) || { name: 'Canal en vivo', stream_id: streamId };
        const img = cleanImageUrl(item.stream_icon);
        return createJsonResponse({
            meta: {
                id,
                type: 'tv',
                name: item.name || 'Canal en vivo',
                poster: img,
                posterShape: 'square',
                background: img,
                genres: [item.category_name || 'Live TV']
            }
        });
    } else if (id.includes('_vod_')) {
        const streamId = id.split('_vod_')[1];
        const vodStreams = await fetchVodStreamsCached(server, username, password);
        const item = vodStreams.find((s) => String(s.stream_id) === String(streamId)) || { name: 'Película', stream_id: streamId };
        const img = cleanImageUrl(item.poster || item.stream_icon);
        return createJsonResponse({
            meta: {
                id,
                type: 'movie',
                name: item.name || 'Película',
                poster: img,
                posterShape: 'poster',
                background: img,
                description: item.plot || item.name || '',
                genres: [item.category_name || 'Películas']
            }
        });
    } else if (id.includes('_series_')) {
        const seriesId = id.split('_series_')[1];
        const seriesList = await fetchSeriesCached(server, username, password);
        const item = seriesList.find((s) => String(s.series_id) === String(seriesId)) || { name: 'Serie', series_id: seriesId };
        const seriesInfo = await fetchSeriesInfoCached(server, username, password, seriesId);
        const img = cleanImageUrl(item.cover || item.poster || (seriesInfo.info && seriesInfo.info.cover));
        const videos = [];

        if (seriesInfo && seriesInfo.episodes) {
            Object.keys(seriesInfo.episodes).forEach((sNum) => {
                const epList = seriesInfo.episodes[sNum];
                if (Array.isArray(epList)) {
                    epList.forEach((ep) => {
                        const season = parseInt(ep.season || sNum || '1', 10);
                        const episode = parseInt(ep.episode_num || ep.episode || '1', 10);
                        const epStreamId = ep.id || ep.stream_id;
                        const ext = ep.container_extension || 'mp4';
                        const epImg = cleanImageUrl(ep.info && ep.info.movie_image);

                        videos.push({
                            id: `${id}:${season}:${episode}:${epStreamId}:${ext}`,
                            title: ep.title || `Episodio ${episode}`,
                            season: season,
                            episode: episode,
                            thumbnail: epImg || img,
                            overview: (ep.info && ep.info.plot) || ''
                        });
                    });
                }
            });
        }

        return createJsonResponse({
            meta: {
                id,
                type: 'series',
                name: item.name || (seriesInfo.info && seriesInfo.info.name) || 'Serie',
                poster: img,
                posterShape: 'poster',
                background: img,
                description: item.plot || (seriesInfo.info && seriesInfo.info.plot) || '',
                genres: [item.category_name || 'Series'],
                videos: videos.length > 0 ? videos : undefined
            }
        });
    }

    return createJsonResponse({ meta: { id, type, name: 'IPTV Content' } });
}

/**
 * Serve stream requests (playable URLs)
 */
async function handleStream(source, type, id) {
    const { server, username, password } = source;
    let streams = [];
    if (type === 'tv' && id.includes('_live_')) {
        const streamId = id.split('_live_')[1];
        const items = await fetchLiveStreamsCached(server, username, password).catch(() => []);
        const item = Array.isArray(items) ? items.find((entry) => String(entry.stream_id) === String(streamId)) : null;
        const title = item ? (item.name || 'Canal en vivo') : 'Canal en vivo';
        const directSources = item ? [item.direct_source, item.stream_url] : [];

        streams = await resolveStreams(source, 'live', streamId, 'm3u8', title, directSources);
    } else if (type === 'movie' && id.includes('_vod_')) {
        const streamId = id.split('_vod_')[1];
        const items = await fetchVodStreamsCached(server, username, password);
        const item = items.find((entry) => String(entry.stream_id) === streamId) || {};
        streams = await resolveStreams(source, 'movie', streamId, item.container_extension || 'mp4', item.name || 'Película', [item.direct_source, item.stream_url]);
    } else if (type === 'series' && id.includes('_series_')) {
        // A series ID is not an episode ID. Preserve the episode's declared container.
        const [seriesId, season, episode, episodeId, extension] = id.split('_series_')[1].split(':');
        if (episodeId && season && episode) {
            streams = await resolveStreams(source, 'series', episodeId, extension || 'mp4', 'Capítulo ' + episode);
        } else if (season && episode) {
            const info = await fetchSeriesInfoCached(server, username, password, seriesId);
            const entry = Object.values(info.episodes || {}).flat().find((ep) =>
                String(ep.season) === season && String(ep.episode_num || ep.episode) === episode);
            if (entry) {
                streams = await resolveStreams(source, 'series', entry.id || entry.stream_id, entry.container_extension || 'mp4', entry.title || 'Capítulo ' + episode, [entry.direct_source, entry.stream_url]);
            }
        }
    }
    return createJsonResponse({ streams });
}

// Helpers for cached fetching
async function fetchApiCached(server, username, password, action, seriesId) {
    const params = new URLSearchParams({ username, password, action });
    if (seriesId !== undefined) params.set(action === 'get_vod_info' ? 'vod_id' : 'series_id', seriesId);
    const url = `${server.replace(/\/+$/, '')}/player_api.php?${params}`;
    const cached = getCached(url);
    if (cached !== null) return cached;
    if (pendingRequests.has(url)) return pendingRequests.get(url);

    const request = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error('Xtream API request failed');
            const data = await response.json();
            const valid = action === 'get_series_info' || action === 'get_vod_info'
                ? data && typeof data === 'object' && !Array.isArray(data) &&
                    (action === 'get_series_info' ? data.episodes : data.info || data.movie_data)
                : Array.isArray(data);
            if (!valid) throw new Error('Invalid Xtream API response');
            setCache(url, data);
            return data;
        } finally {
            clearTimeout(timer);
        }
    })();
    pendingRequests.set(url, request);
    try {
        return await request;
    } finally {
        pendingRequests.delete(url);
    }
}

function fetchLiveStreamsCached(server, username, password) {
    return fetchApiCached(server, username, password, 'get_live_streams');
}

function fetchVodStreamsCached(server, username, password) {
    return fetchApiCached(server, username, password, 'get_vod_streams');
}

function fetchSeriesCached(server, username, password) {
    return fetchApiCached(server, username, password, 'get_series');
}

function fetchSeriesInfoCached(server, username, password, seriesId) {
    return fetchApiCached(server, username, password, 'get_series_info', seriesId);
}

function createJsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}

module.exports = {
    setupXtreamInterceptor,
    handleXtreamRequest,
    fetchApiCached
};
