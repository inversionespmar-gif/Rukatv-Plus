// RukaTv - Xtream Codes Fetch Interceptor & Addon Protocol Handler
// Intercepts browser fetch requests to https://xtream.internal/* and serves Stremio addon responses

const { loadSourcesAsync } = require('./xtreamStorage');

// In-memory cache for catalog & category data to keep browsing ultra-fast
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes — keeps large catalogs (2000+ items) in memory

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
 * Main fetch interceptor
 */
function setupXtreamInterceptor() {
    if (typeof window === 'undefined' || !window.fetch) return;

    const originalFetch = window.fetch;
    window.fetch = async function (resource, options) {
        const urlStr = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

        if (urlStr.includes('xtream.internal')) {
            try {
                const response = await handleXtreamRequest(urlStr);
                return response;
            } catch (err) {
                console.error('Error handling Xtream request:', err);
                return new Response(JSON.stringify({ err: err.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
        }

        if (urlStr.includes('/proxy/http') || urlStr.includes('/proxy/https')) {
            try {
                const response = await handleProxyRequest(urlStr);
                return response;
            } catch (err) {
                console.error('Error handling Xtream proxy request:', err);
            }
        }

        return originalFetch.call(this, resource, options);
    };
}

/**
 * Handle proxy requests for Xtream stream segments (/proxy/https...)
 * Also rewrites m3u8 sub-playlist segment lines to absolute URLs so Hls.js can resolve them
 */
async function handleProxyRequest(urlStr) {
    const proxyIdx = urlStr.indexOf('/proxy/');
    if (proxyIdx === -1) return new Response('Not found', { status: 404 });

    let proxyPath = urlStr.substring(proxyIdx);
    // Clean trailing ?t=xxxx that corrupts vimeos proxy signature
    proxyPath = proxyPath.replace(/([?&])t=[a-z0-9]+$/i, '');

    const sources = await loadSourcesAsync();
    const activeServer = (sources.length > 0 && sources[0].server)
        ? sources[0].server
        : 'https://rukaserver2-hnxt.onrender.com';

    const serverOrigin = activeServer.replace(/\/$/, '');
    const targetUrl = serverOrigin + proxyPath;

    const res = await fetch(targetUrl);
    const contentType = res.headers.get('content-type') || '';

    // If response is an m3u8 playlist, rewrite relative /proxy/ lines to absolute URLs
    if (contentType.includes('mpegurl') || proxyPath.includes('.m3u8')) {
        const text = await res.text();
        const rewritten = text
            .replace(/URI=["']\/proxy\//gi, `URI="${serverOrigin}/proxy/`)
            .replace(/^(\/proxy\/)/gmi, `${serverOrigin}/proxy/`)
            .replace(/(\/proxy\/http[s]?%3A[^\s"'\n]+)\?t=[a-z0-9]+/gi, '$1');
        return new Response(rewritten, {
            status: res.status,
            headers: {
                'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            }
        });
    }

    // Binary response (video segments, audio)
    const body = await res.arrayBuffer();
    return new Response(body, {
        status: res.status,
        headers: {
            'Content-Type': contentType || 'video/MP2T',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*'
        }
    });
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
        return handleManifest(source, sourceId);
    }

    if (resource === 'playlist') {
        const pType = pathParts[2];
        let rawStreamId = pathParts[3] || '';
        if (rawStreamId.includes(':')) {
            const parts = rawStreamId.split(':');
            if (parts.length >= 4) {
                rawStreamId = parts[3];
            }
        }
        const pStreamId = rawStreamId.replace(/\.m3u8$/, '');
        return handlePlaylist(source, pType, pStreamId);
    }

    const type = pathParts[2]; // tv | movie | series
    let rawId = '';

    // Extract extra params if present (e.g. search=avatar or genre=Paraguay or skip=100)
    let genre = parsed.searchParams.get('genre') || '';
    let search = parsed.searchParams.get('search') || '';
    let skip = parseInt(parsed.searchParams.get('skip') || '0', 10);

    // Inspect all pathParts from index 3 onwards for extra parameters like search=query.json
    if (pathParts.length > 3) {
        for (let i = 3; i < pathParts.length; i++) {
            const part = pathParts[i];
            const cleanPart = part.replace(/\.json$/, '');
            if (cleanPart.includes('=')) {
                const eqIdx = cleanPart.indexOf('=');
                const key = cleanPart.substring(0, eqIdx);
                const val = decodeURIComponent(cleanPart.substring(eqIdx + 1) || '');
                if (key === 'genre') genre = val;
                if (key === 'search') search = val;
                if (key === 'skip') skip = parseInt(val, 10);
            } else if (i === 3) {
                rawId = cleanPart;
            }
        }
    }

    if (resource === 'catalog') {
        return await handleCatalog(source, type, rawId, genre, skip, search);
    } else if (resource === 'meta') {
        return await handleMeta(source, type, rawId);
    } else if (resource === 'stream') {
        return await handleStream(source, type, rawId);
    }

    return createJsonResponse({ err: 'Unknown resource' }, 404);
}

/**
 * Serve manifest.json
 */
function handleManifest(source, sourceId) {
    const s = source || { id: sourceId, name: 'IPTV Xtream' };
    const manifest = {
        id: s.id,
        version: '1.0.0',
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
                    { name: 'genre', isRequired: false },
                    { name: 'skip', isRequired: false }
                ]
            },
            {
                type: 'movie',
                id: `${s.id}_vod`,
                name: 'Películas VOD',
                extra: [
                    { name: 'search', isRequired: false },
                    { name: 'genre', isRequired: false },
                    { name: 'skip', isRequired: false }
                ]
            },
            {
                type: 'series',
                id: `${s.id}_series`,
                name: 'Series',
                extra: [
                    { name: 'search', isRequired: false },
                    { name: 'genre', isRequired: false },
                    { name: 'skip', isRequired: false }
                ]
            }
        ],
        idPrefixes: ['xc_']
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
    const q = searchQuery ? searchQuery.toLowerCase().trim() : '';

    if (type === 'tv') {
        const liveStreams = await fetchLiveStreamsCached(server, username, password);
        let filtered = liveStreams;
        if (genre) {
            filtered = filtered.filter((item) => String(item.category_id) === String(genre) || item.category_name === genre);
        }
        if (q) {
            filtered = filtered.filter((item) => (item.name || '').toLowerCase().includes(q));
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
            filtered = filtered.filter((item) => (item.name || '').toLowerCase().includes(q));
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
            filtered = filtered.filter((item) => (item.name || '').toLowerCase().includes(q));
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
    const streams = [];

    const u = encodeURIComponent(username);
    const p = encodeURIComponent(password);

    if (id.includes('_live_')) {
        const streamId = id.split('_live_')[1];
        const liveStreams = await fetchLiveStreamsCached(server, username, password);
        const item = liveStreams.find((s) => String(s.stream_id) === String(streamId));

        if (item && item.stream_url && (item.stream_url.endsWith('.m3u8') || item.stream_url.endsWith('.ts'))) {
            streams.push({
                name: 'RukaTv IPTV',
                title: (item && item.name) || 'Canal en Vivo',
                url: item.stream_url,
                type: item.stream_url.endsWith('.m3u8') ? 'hls' : undefined,
                behaviorHints: { notSupported: false }
            });
        }

        // Direct Xtream live streams (m3u8 and ts)
        streams.push({
            name: 'RukaTv IPTV (HLS)',
            title: 'Canal en Vivo (m3u8)',
            url: `${server}/live/${u}/${p}/${streamId}.m3u8`,
            type: 'hls',
            behaviorHints: { notSupported: false }
        });
        streams.push({
            name: 'RukaTv IPTV (TS)',
            title: 'Canal en Vivo (ts)',
            url: `${server}/live/${u}/${p}/${streamId}.ts`,
            behaviorHints: { notSupported: false }
        });

    } else if (id.includes('_vod_')) {
        const streamId = id.split('_vod_')[1];
        const vodStreams = await fetchVodStreamsCached(server, username, password);
        const item = vodStreams.find((s) => String(s.stream_id) === String(streamId));
        const ext = (item && item.container_extension) || 'mp4';

        // Direct Xtream server movie URLs
        streams.push({
            name: 'RukaTv Direct MP4',
            title: (item && item.name) || 'Película (mp4)',
            url: `${server}/movie/${u}/${p}/${streamId}.${ext}`
        });
        streams.push({
            name: 'RukaTv Direct HLS',
            title: (item && item.name) || 'Película (m3u8)',
            url: `${server}/movie/${u}/${p}/${streamId}.m3u8`
        });

        // Add external video URLs if they are direct video files
        if (item && item.stream_url) {
            try {
                let parsedUrls = item.stream_url;
                if (typeof parsedUrls === 'string' && parsedUrls.startsWith('[')) {
                    parsedUrls = JSON.parse(parsedUrls);
                }
                if (Array.isArray(parsedUrls)) {
                    parsedUrls.forEach((url, idx) => {
                        if (typeof url === 'string' && !url.endsWith('.html')) {
                            streams.push({
                                name: `Servidor Externo #${idx + 1}`,
                                title: (item && item.name) || 'Película',
                                url: url
                            });
                        }
                    });
                } else if (typeof parsedUrls === 'string' && !parsedUrls.endsWith('.html')) {
                    streams.push({
                        name: 'Servidor Externo',
                        title: (item && item.name) || 'Película',
                        url: parsedUrls
                    });
                }
            } catch (_e) {
                // ignore
            }
        }

    } else if (id.includes('_series_')) {
        // URL-decode the id first — Stremio may pass colons as %3A
        const decodedId = decodeURIComponent(id);
        let epStreamId = '';

        if (decodedId.includes(':')) {
            // Format: xc_..._series_SERIESID:SEASON:EPISODE:STREAMID:EXT
            const parts = decodedId.split(':');
            if (parts.length >= 4) {
                epStreamId = parts[3]; // numeric stream ID, e.g. "9"
            }
        } else {
            epStreamId = decodedId.split('_series_')[1] || '';
        }
        // Remove any trailing extension like .m3u8
        epStreamId = epStreamId.replace(/\.m3u8$/, '');

        if (epStreamId) {
            // Direct server URL — same pattern as working movie streams.
            streams.push({
                name: 'RukaTv Episodio',
                title: 'Capítulo (HLS)',
                url: `${server}/series/${u}/${p}/${epStreamId}.m3u8`,
                type: 'hls',
                behaviorHints: { notSupported: false }
            });
        }
    }

    return createJsonResponse({ streams });
}

/**
 * Serve rewritten m3u8 playlist requests - rewrites ALL /proxy/ paths to absolute server URLs
 * including both master playlist variant lines and sub-playlist .ts segment lines
 */
async function handlePlaylist(source, type, streamId) {
    const { server, username, password } = source;
    const u = encodeURIComponent(username);
    const p = encodeURIComponent(password);

    let originalUrl = '';
    if (type === 'series') {
        originalUrl = `${server}/series/${u}/${p}/${streamId}.m3u8`;
    } else if (type === 'movie' || type === 'vod') {
        originalUrl = `${server}/movie/${u}/${p}/${streamId}.m3u8`;
    } else {
        originalUrl = `${server}/live/${u}/${p}/${streamId}.m3u8`;
    }

    try {
        const serverOrigin = server.replace(/\/$/, '');
        const masterRes = await fetch(originalUrl);
        const masterText = await masterRes.text();

        // Find the best variant sub-playlist URL from the master
        // Priority: HD (_h/) over SD (_n/)
        const masterLines = masterText.split(/\r?\n/);
        let bestVariantPath = null;
        for (const line of masterLines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('/proxy/')) {
                // Clean trailing ?t= token
                const cleanPath = trimmed.replace(/([?&])t=[a-z0-9]+$/i, '');
                if (!bestVariantPath || cleanPath.includes('_h/')) {
                    bestVariantPath = cleanPath;
                    if (cleanPath.includes('_h/')) break; // HD found, stop
                }
            }
        }

        if (bestVariantPath) {
            // Fetch the actual variant sub-playlist
            const subPlaylistUrl = serverOrigin + bestVariantPath;
            const subRes = await fetch(subPlaylistUrl);
            const subText = await subRes.text();

            // Rewrite ALL /proxy/ lines in the sub-playlist to absolute server URLs
            // This ensures Hls.js can resolve every .ts segment directly
            const rewrittenSub = subText
                .replace(/URI=["']\/proxy\//gi, `URI="${serverOrigin}/proxy/`)
                .replace(/^(\/proxy\/)/gmi, `${serverOrigin}/proxy/`)
                .replace(/(\/proxy\/http[s]?%3A[^\s"'\n]+)\?t=[a-z0-9]+/gi, '$1');

            return new Response(rewrittenSub, {
                status: 200,
                headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': '*'
                }
            });
        }

        // Fallback: return rewritten master if no variant found
        const rewrittenMaster = masterText
            .replace(/URI=["']\/proxy\//gi, `URI="${serverOrigin}/proxy/`)
            .replace(/^(\/proxy\/)/gmi, `${serverOrigin}/proxy/`)
            .replace(/(\/proxy\/http[s]?%3A[^\s"'\n]+)\?t=[a-z0-9]+/gi, '$1');

        return new Response(rewrittenMaster, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            }
        });
    } catch (err) {
        console.error('Error rewriting playlist:', err);
        return new Response('#EXTM3U\n', { status: 500 });
    }
}

// Helpers for cached fetching
async function fetchLiveStreamsCached(server, username, password) {
    const cacheKey = `raw_live_${server}_${username}`;
    let data = getCached(cacheKey);
    if (!data) {
        const url = `${server}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
        const res = await fetch(url);
        data = await res.json();
        setCache(cacheKey, Array.isArray(data) ? data : []);
    }
    return Array.isArray(data) ? data : [];
}

async function fetchVodStreamsCached(server, username, password) {
    const cacheKey = `raw_vod_${server}_${username}`;
    let data = getCached(cacheKey);
    if (!data) {
        const url = `${server}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_vod_streams`;
        const res = await fetch(url);
        data = await res.json();
        setCache(cacheKey, Array.isArray(data) ? data : []);
    }
    return Array.isArray(data) ? data : [];
}

async function fetchSeriesCached(server, username, password) {
    const cacheKey = `raw_series_${server}_${username}`;
    let data = getCached(cacheKey);
    if (!data) {
        const url = `${server}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series`;
        const res = await fetch(url);
        data = await res.json();
        setCache(cacheKey, Array.isArray(data) ? data : []);
    }
    return Array.isArray(data) ? data : [];
}

async function fetchSeriesInfoCached(server, username, password, seriesId) {
    const cacheKey = `raw_series_info_${server}_${seriesId}`;
    let data = getCached(cacheKey);
    if (!data) {
        const url = `${server}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${seriesId}`;
        const res = await fetch(url);
        data = await res.json();
        setCache(cacheKey, data || {});
    }
    return data || {};
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
    handleProxyRequest
};
