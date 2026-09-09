const { resolveStreams, probeMedia, directUrls, mediaType } = require('../src/routes/Addons/XtreamAddon/xtreamStreams');

const source = { id: 'test_source', server: 'https://xc.example', username: 'user', password: 'pass' };
const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
});

test('detects HLS returned by a .mp4 endpoint and passes a canonical MIME to the original player', async () => {
    global.fetch = jest.fn(async () => new Response(null, {
        headers: { 'content-type': 'application/vnd.apple.mpegurl; charset=utf-8' }
    }));
    const streams = await resolveStreams(source, 'movie', '17', 'mp4', 'Movie');
    expect(streams).toEqual([{
        name: 'RukaTv HLS', title: 'Movie', url: 'https://xc.example/movie/user/pass/17.mp4',
        behaviorHints: { proxyHeaders: { response: { 'content-type': 'application/vnd.apple.mpegurl' } } }
    }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].method).toBe('HEAD');
});

test('keeps genuine MP4 media in the native MP4 path', async () => {
    global.fetch = jest.fn(async () => new Response(null, { headers: { 'content-type': 'video/mp4' } }));
    const [stream] = await resolveStreams(source, 'series', '31', 'mp4', 'Episode');
    expect(stream.url).toBe('https://xc.example/series/user/pass/31.mp4');
    expect(stream.behaviorHints.proxyHeaders.response['content-type']).toBe('video/mp4');
});

test('supports providers that reject HEAD and detects an octet-stream HLS prefix', async () => {
    global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(null, { status: 405 }))
        .mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:10,\nsegment.ts', { headers: { 'content-type': 'application/octet-stream' } }));
    expect(await probeMedia('https://xc.example/movie')).toBe('application/vnd.apple.mpegurl');
    expect(global.fetch.mock.calls[1][1].headers.Range).toBe('bytes=0-1023');
});

test('detects an MP4 prefix and cancels the body without downloading the movie', async () => {
    const cancel = jest.fn();
    global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(null, { status: 501 }))
        .mockResolvedValueOnce(new Response(new ReadableStream({
            start(controller) { controller.enqueue(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])); },
            cancel
        })));
    expect(await probeMedia('https://xc.example/video')).toBe('video/mp4');
    expect(cancel).toHaveBeenCalledTimes(1);
});

test('does not offer HTML embed pages or failed endpoints as playable media', async () => {
    global.fetch = jest.fn(async () => new Response('Not found', { status: 404 }));
    expect(await resolveStreams(source, 'movie', '1', 'mp4', 'Movie', [
        '["https://embed.example/e/abc", "https://embed.example/embed-abc.html"]'
    ])).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('rejects an HTML body even when its URL has an mp4 extension', async () => {
    global.fetch = jest.fn(async () => new Response('<html>Login required</html>', { headers: { 'content-type': 'text/html' } }));
    expect(await probeMedia('https://xc.example/video.mp4')).toBeNull();
});

test('uses a real signed media URL as fallback without changing its query', async () => {
    const direct = 'https://cdn.example/master.m3u8?token=abc&t=signature';
    global.fetch = jest.fn(async (url) => new Response(null, url === direct ? {
        headers: { 'content-type': 'application/x-mpegURL' }
    } : { status: 404 }));
    const [stream] = await resolveStreams(source, 'movie', '1', 'mp4', 'Movie', [[direct]]);
    expect(stream.url).toBe(direct);
    expect(stream.name).toBe('RukaTv HLS');
});

test('filters embed URLs by parsed pathname, preserving direct signed files', () => {
    expect(directUrls('["https://cdn.example/v.mp4?token=x", "https://embed.example/e/123", "https://embed.example/a.html?x=.mp4"]', source.server))
        .toEqual(['https://cdn.example/v.mp4?token=x']);
    expect(mediaType('APPLICATION/X-MPEGURL; charset=UTF-8')).toBe('application/vnd.apple.mpegurl');
});

test('encodes credentials and keeps the selected source instead of using the first saved server', async () => {
    global.fetch = jest.fn(async () => new Response(null, { headers: { 'content-type': 'video/mp4' } }));
    const [stream] = await resolveStreams({ ...source, server: 'https://second.example/', username: 'a/b', password: 'p?#' }, 'movie', '7', 'mp4', 'Movie');
    expect(stream.url).toBe('https://second.example/movie/a%2Fb/p%3F%23/7.mp4');
});

function interceptor() {
    jest.doMock('../src/routes/Addons/XtreamAddon/xtreamStorage', () => ({ loadSourcesAsync: async () => [source] }));
    return require('../src/routes/Addons/XtreamAddon/xtreamInterceptor');
}

test('intercepts only the addon host, leaving proxy requests, Range headers and abort signals intact', async () => {
    const nativeFetch = jest.fn(async () => new Response('native'));
    const scope = { fetch: nativeFetch, location: { href: 'https://app.example/' } };
    const { setupXtreamInterceptor } = interceptor();
    setupXtreamInterceptor(scope);
    const firstWrapper = scope.fetch;
    setupXtreamInterceptor(scope);
    expect(scope.fetch).toBe(firstWrapper);
    const options = { headers: { Range: 'bytes=0-1023' }, signal: new AbortController().signal };
    const url = new URL('https://second.example/proxy/encoded?t=keep');
    await scope.fetch(url, options);
    expect(nativeFetch).toHaveBeenCalledWith(url, options);
    const request = new Request('https://other.example/xtream.internal/anything');
    await scope.fetch(request);
    expect(nativeFetch).toHaveBeenCalledWith(request, undefined);
    const manifest = await scope.fetch(new URL('https://xtream.internal/test_source/manifest.json'));
    expect((await manifest.json()).id).toBe(source.id);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
});

test('supports the worker scope without a window object', async () => {
    const scope = { fetch: jest.fn() };
    interceptor().setupXtreamInterceptor(scope);
    const response = await scope.fetch('https://xtream.internal/test_source/manifest.json');
    expect(response.status).toBe(200);
});

test.each(['mp4', 'm3u8'])('uses the encoded episode ID and its %s container', async (extension) => {
    global.fetch = jest.fn(async () => new Response(null, { headers: { 'content-type': extension === 'mp4' ? 'video/mp4' : 'application/vnd.apple.mpegurl' } }));
    const id = encodeURIComponent('xc_test_source_series_8:1:2:99:' + extension);
    const response = await interceptor().handleXtreamRequest('https://xtream.internal/test_source/stream/series/' + id + '.json');
    const { streams } = await response.json();
    expect(streams[0].url).toBe('https://xc.example/series/user/pass/99.' + extension);
});

test('does not mistake a series ID for an episode ID', async () => {
    global.fetch = jest.fn();
    const response = await interceptor().handleXtreamRequest('https://xtream.internal/test_source/stream/series/xc_test_source_series_8.json');
    expect((await response.json()).streams).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
});


test('keeps live channels that declare an MP4 container', async () => {
    global.fetch = jest.fn(async (url) => url.includes('player_api.php')
        ? new Response(JSON.stringify([{ stream_id: 12, container_extension: 'mp4', name: 'Live' }]))
        : new Response(null, { headers: { 'content-type': 'video/mp4' } }));
    const response = await interceptor().handleXtreamRequest('https://xtream.internal/test_source/stream/tv/xc_test_source_live_12.json');
    expect((await response.json()).streams[0].url).toBe('https://xc.example/live/user/pass/12.mp4');
});
