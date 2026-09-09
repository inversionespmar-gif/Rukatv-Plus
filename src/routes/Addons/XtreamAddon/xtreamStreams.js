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
    const ext = /^[a-z0-9]+$/i.test(extension || '') ? extension.toLowerCase() : 'mp4';
    const path = [kind, source.username, source.password, streamId].map(encodeURIComponent).join('/');
    // Keep the server's resolver/proxy URL so headers, signatures and relative HLS paths survive.
    const candidates = [...new Set([
        `${server}/${path}.${ext}`,
        ...directSources.flatMap((value) => directUrls(value, server))
    ])];
    const streams = [];
    for (const url of candidates) {
        const type = await probeMedia(url);
        if (!type) continue;
        streams.push({
            name: type === HLS_TYPE ? 'RukaTv HLS' : 'RukaTv MP4',
            title,
            url,
            behaviorHints: {
                // Supported by Stremio's getContentType; no player or HLS loader changes.
                proxyHeaders: { response: { 'content-type': type } }
            }
        });
        // Prefer the authenticated server resolver; external media is a fallback.
        break;
    }
    return streams;
}

module.exports = { resolveStreams, directUrls, mediaType, probeMedia };
