const source = { id: 'test_source', server: 'https://xc.example', username: 'private-user', password: 'private-password' };
const addon = {
    transportUrl: 'https://subs.example/config/manifest.json',
    manifest: { id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3', resources: ['subtitles'], types: ['movie', 'series'], idPrefixes: ['tt'] }
};
const metadata = {
    transportUrl: 'https://metadata.example/manifest.json',
    manifest: { resources: ['catalog', 'meta'], types: ['movie', 'series'], idPrefixes: ['tt'], catalogs: [
        { type: 'movie', id: 'top', extra: [{ name: 'search' }] }
    ] }
};
const subtitle = { id: '1', lang: 'spa', url: 'https://subs.example/file.srt' };
const json = (value) => new Response(JSON.stringify(value));
const originalFetch = global.fetch;

function loader() {
    jest.doMock('../src/routes/Addons/XtreamAddon/xtreamStorage', () => ({ loadSourcesAsync: async () => [source] }));
    return require('../src/routes/Addons/XtreamAddon/xtreamSubtitles').loadXtreamSubtitles;
}

afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.resetModules();
});

test('uses provider IMDb metadata for movie subtitle requests without sending Xtream credentials', async () => {
    global.fetch = jest.fn(async (url) => url.includes('player_api.php')
        ? json({ info: { imdb_id: 'tt0133093' } }) : json({ subtitles: [subtitle] }));
    const onTracks = jest.fn();
    await loader()({ type: 'movie', videoId: 'xc_test_source_vod_42', addons: [addon], onTracks });
    expect(global.fetch.mock.calls[0][0]).toContain('action=get_vod_info&vod_id=42');
    expect(global.fetch.mock.calls[1][0]).toBe('https://subs.example/config/subtitles/movie/tt0133093.json');
    expect(onTracks).toHaveBeenCalledWith([expect.objectContaining({ lang: 'spa', origin: 'OpenSubtitles v3', url: subtitle.url })]);
});

test('uses series IMDb ID plus season and episode, not the Xtream episode stream ID', async () => {
    global.fetch = jest.fn(async (url) => url.includes('player_api.php')
        ? json({ info: { imdb: 'https://www.imdb.com/title/tt0944947/' }, episodes: {} })
        : json({ subtitles: [subtitle] }));
    const load = loader();
    const onTracks = jest.fn();
    await load({ type: 'series', videoId: 'xc_test_source_series_8:1:2:99:mp4', addons: [addon], onTracks });
    await load({ type: 'series', videoId: 'xc_test_source_series_8:1:3:100:m3u8', addons: [addon], onTracks });
    expect(global.fetch.mock.calls.map(([url]) => url).slice(1)).toEqual([
        'https://subs.example/config/subtitles/series/tt0944947%3A1%3A2.json',
        'https://subs.example/config/subtitles/series/tt0944947%3A1%3A3.json'
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('resolves an exact title and year using installed metadata addons when IMDb is missing', async () => {
    global.fetch = jest.fn(async (url) => {
        if (url.includes('player_api.php')) return json({ info: { name: 'The Matrix (1999)', releasedate: '1999-03-31', tmdb_id: '603' } });
        if (url.includes('metadata.example')) return json({ metas: [
            { id: 'tt0133093', name: 'The Matrix', releaseInfo: '1999' },
            { id: 'tt1234567', name: 'The Matrix', releaseInfo: '2021' }
        ] });
        return json({ subtitles: [subtitle] });
    });
    await loader()({ type: 'movie', videoId: 'xc_test_source_vod_42', addons: [addon, metadata], onTracks: jest.fn() });
    expect(global.fetch.mock.calls[1][0]).toBe('https://metadata.example/catalog/movie/top/search=The%20Matrix.json');
    expect(global.fetch.mock.calls[2][0]).toContain('/subtitles/movie/tt0133093.json');
});

test('does not guess a title when multiple IMDb matches remain', async () => {
    global.fetch = jest.fn(async (url) => url.includes('player_api.php')
        ? json({ info: { name: 'Same Title', tmdb_id: '1234567' } })
        : json({ metas: [{ id: 'tt1234567', name: 'Same Title' }, { id: 'tt2345678', name: 'Same Title' }] }));
    const onTracks = jest.fn();
    await loader()({ type: 'movie', videoId: 'xc_test_source_vod_42', addons: [addon, metadata], onTracks });
    expect(onTracks).not.toHaveBeenCalled();
    expect(global.fetch.mock.calls.some(([url]) => url.includes('/subtitles/'))).toBe(false);
});

test('honors resource-specific types and prefixes and isolates failing subtitle addons', async () => {
    const other = { ...addon, transportUrl: 'https://other.example/manifest.json', manifest: {
        name: 'Other subtitles', resources: [{ name: 'subtitles', types: ['movie'], idPrefixes: ['tt'] }], types: []
    } };
    const unsupported = { ...addon, manifest: { ...addon.manifest, idPrefixes: ['kitsu:'] } };
    global.fetch = jest.fn(async (url) => {
        if (url.includes('player_api.php')) return json({ info: { imdb_id: 'tt0133093' } });
        if (url.includes('other.example')) return json({ subtitles: [subtitle, { lang: 'spa', url: 'javascript:bad' }] });
        return new Response('', { status: 503 });
    });
    const onTracks = jest.fn();
    await loader()({ type: 'movie', videoId: 'xc_test_source_vod_42', addons: [addon, other, unsupported], onTracks });
    expect(onTracks).toHaveBeenCalledTimes(1);
    expect(onTracks.mock.calls[0][0]).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('discards subtitles from a previous episode after cancellation', async () => {
    const controller = new AbortController();
    global.fetch = jest.fn(async (url) => {
        if (url.includes('player_api.php')) return json({ info: { imdb_id: 'tt0944947' }, episodes: {} });
        controller.abort();
        return json({ subtitles: [subtitle] });
    });
    const onTracks = jest.fn();
    await loader()({ type: 'series', videoId: 'xc_test_source_series_8:1:2:99:mp4', addons: [addon], signal: controller.signal, onTracks });
    expect(onTracks).not.toHaveBeenCalled();
});

test.each([
    ['movie', 'tt0133093', [addon]],
    ['tv', 'xc_test_source_live_1', [addon]],
    ['movie', 'xc_test_source_vod_42', []],
    ['series', 'xc_test_source_series_8', [addon]]
])('does not issue unnecessary requests for %s / %s', async (type, videoId, addons) => {
    global.fetch = jest.fn();
    await loader()({ type, videoId, addons, onTracks: jest.fn() });
    expect(global.fetch).not.toHaveBeenCalled();
});

test('subtitle addon timeouts do not block playback or other addons', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((url, { signal }) => url.includes('player_api.php')
        ? Promise.resolve(json({ info: { imdb_id: 'tt0133093' } }))
        : new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')))));
    const onTracks = jest.fn();
    const pending = loader()({ type: 'movie', videoId: 'xc_test_source_vod_42', addons: [addon], onTracks });
    await jest.advanceTimersByTimeAsync(15000);
    await pending;
    expect(onTracks).not.toHaveBeenCalled();
});
