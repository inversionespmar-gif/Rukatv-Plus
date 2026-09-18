const { getSearchCatalogs, getCoreSearchRange } = require('../src/routes/Search/searchCatalogs');
const source = { id: 'test_source', server: 'https://xc.example', username: 'user', password: 'pass' };
const originalFetch = global.fetch;
const catalogUrl = (extra, type = 'movie') => `https://xtream.internal/test_source/catalog/${type}/test_source_vod/${extra}.json`;

function interceptor() {
    jest.doMock('../src/routes/Addons/XtreamAddon/xtreamStorage', () => ({ loadSourcesAsync: async () => [source] }));
    return require('../src/routes/Addons/XtreamAddon/xtreamInterceptor');
}

afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.resetModules();
});

test('loads Xtream core indices after Cinemeta rows and empty results are hidden', () => {
    const catalogs = [
        { addon: { manifest: { id: 'com.linvo.cinemeta' } } },
        { addon: { transportUrl: 'https://v3-cinemeta.strem.io/manifest.json' } },
        { content: { type: 'Err', content: 'EmptyContent' } },
        { content: { type: 'Loading' } },
        { content: { type: 'Loading' } }
    ];
    const visible = getSearchCatalogs(catalogs);
    expect(visible.catalogs).toEqual(catalogs.slice(3));
    expect(getCoreSearchRange(visible.indices, { start: 0, end: 1 })).toEqual({ start: 3, end: 4 });
    expect(getCoreSearchRange(visible.indices, { start: 1, end: 1 })).toEqual({ start: 4, end: 4 });
    // When the first visible row completes empty, the remaining DOM row still loads the right catalog.
    catalogs[3] = { content: { type: 'Ready', content: [] } };
    expect(getCoreSearchRange(getSearchCatalogs(catalogs).indices, { start: 0, end: 0 })).toEqual({ start: 4, end: 4 });
});

test('distinguishes no matching results from no installed search addons', () => {
    expect(getSearchCatalogs([{ content: { type: 'Err', content: 'EmptyContent' } }]))
        .toEqual({ catalogs: [], indices: [], hasSearchAddons: true });
    expect(getSearchCatalogs([]).hasSearchAddons).toBe(false);
    expect(getCoreSearchRange([], { start: 0, end: 0 })).toBeNull();
});

test.each(['movie', 'series', 'tv'])('finds accented titles in the %s catalog with combined search parameters', async (type) => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify([
        { stream_id: 1, series_id: 1, name: 'Otra película', category_id: 7 },
        { stream_id: 2, series_id: 2, name: 'La Ratónera', category_id: 7 },
        { stream_id: 3, series_id: 3, name: 'Ratonera', category_id: 8 }
    ])));
    const response = await interceptor().handleXtreamRequest(catalogUrl('search=ratonera&genre=7&skip=0', type));
    expect((await response.json()).metas.map((meta) => meta.name)).toEqual(['La Ratónera']);
});

test('preserves encoded ampersands, plus signs and equals signs in search terms', async () => {
    const name = 'A & B + C = D';
    global.fetch = jest.fn(async () => new Response(JSON.stringify([{ stream_id: 1, name }])));
    const response = await interceptor().handleXtreamRequest(catalogUrl(`search=${encodeURIComponent(name)}&skip=0`));
    expect((await response.json()).metas[0].name).toBe(name);
});

test('searches the whole catalog before paging and accepts query-string searches', async () => {
    const items = Array.from({ length: 350 }, (_, index) => ({ stream_id: index, name: `Title ${index}` }));
    items.push({ stream_id: 999, name: 'Ratonera' });
    global.fetch = jest.fn(async () => new Response(JSON.stringify(items)));
    const response = await interceptor().handleXtreamRequest('https://xtream.internal/test_source/catalog/movie/test_source_vod.json?search=Ratonera');
    expect((await response.json()).metas[0].id).toBe('xc_test_source_vod_999');
});

test('shares catalog downloads between concurrent searches', async () => {
    let resolveFetch;
    global.fetch = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const { handleXtreamRequest } = interceptor();
    const requests = [handleXtreamRequest(catalogUrl('search=rat')), handleXtreamRequest(catalogUrl('search=ratonera'))];
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    resolveFetch(new Response(JSON.stringify([{ stream_id: 1, name: 'Ratonera' }])));
    const results = await Promise.all(requests);
    expect(await results[0].json()).toEqual(await results[1].json());
});

test.each([
    () => new Response('Unavailable', { status: 503 }),
    () => new Response(JSON.stringify({ user_info: { auth: 0 } }))
])('reports API errors without caching them as empty catalogs', async (failure) => {
    global.fetch = jest.fn().mockResolvedValueOnce(failure())
        .mockResolvedValueOnce(new Response(JSON.stringify([{ stream_id: 1, name: 'Ratonera' }])));
    const scope = { fetch: global.fetch };
    interceptor().setupXtreamInterceptor(scope);
    expect((await scope.fetch(catalogUrl('search=ratonera'))).status).toBe(502);
    const response = await scope.fetch(catalogUrl('search=ratonera'));
    expect((await response.json()).metas).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('ends stalled catalog loads with an error and permits a retry', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted')));
    }));
    const scope = { fetch: global.fetch };
    interceptor().setupXtreamInterceptor(scope);
    const pending = scope.fetch(catalogUrl('search=ratonera'));
    await jest.advanceTimersByTimeAsync(30000);
    expect((await pending).status).toBe(502);
    global.fetch = jest.fn(async () => new Response('[]'));
    expect((await scope.fetch(catalogUrl('search=ratonera'))).status).toBe(200);
});
