const { loadSourcesAsync } = require('./xtreamStorage');
const { fetchApiCached } = require('./xtreamInterceptor');

const identities = new Map();
const normalizeTitle = (title) => String(title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').replace(/[^a-z0-9\p{L}]+/gu, ' ').trim();

function imdbId(record) {
    for (const value of [record?.imdb_id, record?.imdb, record?.imdbId, record?.imdb_url]) {
        const match = String(value || '').match(/(?:^|\/)(tt\d{7,10})(?:$|[/?#])/);
        if (match) return match[1];
    }
    return null;
}

function supports(addon, resourceName, type, id) {
    const manifest = addon.manifest || {};
    return (manifest.resources || []).some((resource) => {
        const descriptor = typeof resource === 'string' ? { name: resource } : resource;
        const types = descriptor.types || manifest.types || [];
        const prefixes = descriptor.idPrefixes ?? manifest.idPrefixes;
        return descriptor.name === resourceName && types.includes(type) &&
            (!id || !prefixes || prefixes.some((prefix) => id.startsWith(prefix)));
    });
}

function addonUrl(addon, path) {
    const url = new URL(addon.transportUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported addon transport');
    url.pathname = url.pathname.replace(/\/manifest\.json\/?$/, '').replace(/\/$/, '') + '/' + path;
    return url.href;
}

async function requestJson(url, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Addon request failed');
        return await response.json();
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

async function resolveIdentity(source, type, itemId, addons, fallbackName, signal) {
    const key = JSON.stringify([source.server, source.username, source.password, type, itemId]);
    if (identities.has(key)) return identities.get(key);
    const info = await fetchApiCached(source.server, source.username, source.password,
        type === 'movie' ? 'get_vod_info' : 'get_series_info', itemId).catch(() => ({}));
    if (signal?.aborted) return null;
    const records = [info.info, info.movie_data, info];
    let id = records.map(imdbId).find(Boolean);
    if (!id) {
        const names = [...new Set(records.flatMap((record) => [record?.name, record?.o_name, record?.original_name, record?.title])
            .concat(fallbackName).filter((name) => typeof name === 'string' && name.trim()))];
        const titles = new Set(names.map(normalizeTitle));
        const yearValue = records.flatMap((record) => [record?.releasedate, record?.releaseDate, record?.release_date, record?.year])
            .find((value) => /(?:19|20)\d{2}/.test(String(value || '')));
        const year = String(yearValue || names.find((name) => /\((?:19|20)\d{2}\)/.test(name)) || '').match(/(?:19|20)\d{2}/)?.[0];
        // Use installed metadata providers only, and accept an unambiguous title/year match.
        const catalogs = addons.filter((addon) => supports(addon, 'meta', type, 'tt0000000'))
            .flatMap((addon) => (addon.manifest.catalogs || [])
                .filter((catalog) => catalog.type === type && catalog.extra?.some((extra) => extra.name === 'search') &&
                    !catalog.extra.some((extra) => extra.isRequired && extra.name !== 'search'))
                .map((catalog) => ({ addon, catalog }))).slice(0, 3);
        for (const name of names.slice(0, 2)) {
            if (signal?.aborted) return null;
            const query = name.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim();
            const results = await Promise.all(catalogs.map(async ({ addon, catalog }) => {
                try {
                    const response = await requestJson(addonUrl(addon,
                        `catalog/${type}/${encodeURIComponent(catalog.id)}/search=${encodeURIComponent(query)}.json`), signal);
                    return (response.metas || []).filter((meta) => /^tt\d{7,10}$/.test(meta.id) &&
                        titles.has(normalizeTitle(meta.name)) && (!year || String(meta.releaseInfo || meta.year || meta.released || '').startsWith(year)));
                } catch (_error) {
                    return [];
                }
            }));
            const matches = [...new Set(results.flat().map((meta) => meta.id))];
            if (matches.length === 1) {
                id = matches[0];
                break;
            }
        }
    }
    if (id) {
        if (identities.size >= 500) identities.delete(identities.keys().next().value);
        identities.set(key, id);
    }
    return id || null;
}

async function loadXtreamSubtitles({ type, videoId, name, addons, signal, onTracks }) {
    if (!['movie', 'series'].includes(type) || !videoId?.startsWith('xc_')) return;
    const subtitleAddons = addons.filter((addon) => supports(addon, 'subtitles', type, 'tt0000000'));
    if (!subtitleAddons.length) return;
    const sources = await loadSourcesAsync();
    const kind = type === 'movie' ? 'vod' : 'series';
    const source = sources.find((entry) => videoId.startsWith(`xc_${entry.id}_${kind}_`));
    if (!source || signal?.aborted) return;
    const [itemId, season, episode] = videoId.slice(`xc_${source.id}_${kind}_`.length).split(':');
    if (type === 'series' && (!/^\d+$/.test(season) || !/^\d+$/.test(episode))) return;
    const imdb = await resolveIdentity(source, type, itemId, addons, name, signal);
    if (!imdb || signal?.aborted) return;
    const id = type === 'series' ? `${imdb}:${Number(season)}:${Number(episode)}` : imdb;
    await Promise.all(subtitleAddons.map(async (addon, addonIndex) => {
        if (!supports(addon, 'subtitles', type, id)) return;
        try {
            const result = await requestJson(addonUrl(addon, `subtitles/${type}/${encodeURIComponent(id)}.json`), signal);
            const tracks = (Array.isArray(result.subtitles) ? result.subtitles : []).filter((track) =>
                typeof track.lang === 'string' && typeof track.url === 'string' && /^https?:\/\//i.test(track.url)
            ).map((track, index) => ({
                ...track,
                id: `xtream:${addonIndex}:${track.id || index}`,
                origin: addon.manifest.name,
                label: track.label || addon.manifest.name
            }));
            if (!signal?.aborted) onTracks(tracks);
        } catch (_error) {
            // One unavailable addon must not discard tracks from the others.
        }
    }));
}

module.exports = { loadXtreamSubtitles };
