// Resolve Xtream media at the addon boundary. The original player receives real URLs.
const HLS_TYPE = 'application/vnd.apple.mpegurl';
const PROBE_TIMEOUT = 20000;

function mediaType(value) {
    const type = (value || '').split(';')[0].trim().toLowerCase();
    if (['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'].includes(type)) {
        return HLS_TYPE;
    }
    return type === 'video/mp4' ? type : null;
}

function directUrls(value, server) {
    if (typeof value === 'string' && value.trim().startsWith('[')) {
        try {
            return directUrls(JSON.parse(value), server);
        } catch (_e) {
            return [];
        }
    }
    if (Array.isArray(value)) return value.flatMap((entry) => directUrls(entry, server));
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const url = new URL(value, server + '/');
        // Embed pages (including /e/ID without .html) are not media files.
        if (!['http:', 'https:'].includes(url.protocol) || !/\.(m3u8|mp4)$/i.test(url.pathname)) return [];
        return [url.href];
    } catch (_e) {
        return [];
    }
}

async function probeMedia(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
    try {
        // The extension is not authoritative: some XC servers return HLS at .mp4 URLs.
        const head = await fetch(url, { method: 'HEAD', signal: controller.signal });
        const type = head.ok && mediaType(head.headers.get('content-type'));
        if (type) return type;
        if (!head.ok && ![405, 501].includes(head.status)) return null;

        // Servers may omit the MIME type or not support HEAD. Read only a prefix.
        const response = await fetch(url, {
            headers: { Range: 'bytes=0-1023' },
            signal: controller.signal
        });
        try {
            if (!response.ok) return null;
            const responseType = mediaType(response.headers.get('content-type'));
            if (responseType) return responseType;
            if (!response.body) return null;
            const reader = response.body.getReader();
            try {
                const bytes = [];
                while (bytes.length < 16) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    bytes.push(...value.subarray(0, 16 - bytes.length));
                }
                const prefix = new TextDecoder().decode(new Uint8Array(bytes));
                if (prefix.trimStart().startsWith('#EXTM3U')) return HLS_TYPE;
                if (prefix.slice(4, 8) === 'ftyp') return 'video/mp4';
                return null;
            } finally {
                await reader.cancel();
            }
        } finally {
            if (response.body && !response.body.locked) await response.body.cancel();
        }
    } catch (_e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function resolveStreams(source, kind, streamId, extension, title, directSources = []) {
    const server = source.server.replace(/\/+$/, '');
    const streams = [];

    if (kind === 'live') {
        const u = encodeURIComponent(source.username);
        const p = encodeURIComponent(source.password);
        const id = encodeURIComponent(streamId);

        const internalHlsUrl = `https://xtream.internal/${source.id}/media/live/${id}.m3u8`;
        const internalTsUrl = `https://xtream.internal/${source.id}/media/live/${id}.ts`;

        const directHlsUrl = `${server}/live/${u}/${p}/${id}.m3u8`;
        const directTsUrl = `${server}/live/${u}/${p}/${id}.ts`;

        // 1. Internal virtual HLS stream (Proxied in-browser to bypass Mixed Content & CORS)
        streams.push({
            name: 'RukaTv Live HLS (Recomendado)',
            title: title || 'Canal en Vivo',
            url: internalHlsUrl
        });

        // 2. Internal virtual TS stream
        streams.push({
            name: 'RukaTv Live TS (Direct Proxy)',
            title: title || 'Canal en Vivo',
            url: internalTsUrl
        });

        // 3. Direct provider HLS stream
        streams.push({
            name: 'RukaTv Live Direct (.m3u8)',
            title: title || 'Canal en Vivo',
            url: directHlsUrl
        });

        // 4. Direct provider TS stream
        streams.push({
            name: 'RukaTv Live Direct (.ts)',
            title: title || 'Canal en Vivo',
            url: directTsUrl
        });

        // 5. Direct provider mirrors
        const extraUrls = directSources.flatMap((value) => directUrls(value, server));
        for (const extraUrl of extraUrls) {
            streams.push({
                name: 'RukaTv Live Mirror',
                title: title || 'Canal en Vivo',
                url: extraUrl
            });
        }

        return streams;
    }

    // For VOD (movies) and Series
    const ext = /^[a-z0-9]+$/i.test(extension || '') ? extension.toLowerCase() : 'mp4';
    const path = [kind, source.username, source.password, streamId].map(encodeURIComponent).join('/');
    const mainUrl = `${server}/${path}.${ext}`;
    const internalUrl = `https://xtream.internal/${source.id}/media/${kind}/${streamId}.${ext}`;

    const candidates = [...new Set([
        internalUrl,
        mainUrl,
        ...directSources.flatMap((value) => directUrls(value, server))
    ])];

    for (const url of candidates) {
        let type = await probeMedia(url);
        if (!type) {
            type = ext === 'm3u8' ? HLS_TYPE : 'video/mp4';
        }
        streams.push({
            name: type === HLS_TYPE ? 'RukaTv HLS' : 'RukaTv MP4',
            title,
            url: url
        });
        break;
    }

    if (streams.length === 0) {
        streams.push({
            name: 'RukaTv Stream',
            title,
            url: internalUrl
        });
    }

    return streams;
}

module.exports = { resolveStreams, directUrls, mediaType, probeMedia };
