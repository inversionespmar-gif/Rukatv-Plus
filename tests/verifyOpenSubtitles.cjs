// Optional live smoke test: node tests/verifyOpenSubtitles.cjs
// Uses fictional Xtream metadata; only public metadata/subtitle services receive network requests.
const assert = require('node:assert/strict');
const source = { id: 'smoke', server: 'https://xtream-smoke.invalid', username: 'test', password: 'test' };
const storage = require.resolve('../src/routes/Addons/XtreamAddon/xtreamStorage');
require.cache[storage] = { id: storage, filename: storage, loaded: true, exports: { loadSourcesAsync: async () => [source] } };
const nativeFetch = global.fetch;
global.fetch = (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'xtream-smoke.invalid') {
        const isSeries = parsed.searchParams.get('action') === 'get_series_info';
        return Promise.resolve(new Response(JSON.stringify(isSeries
            ? { info: { imdb_id: 'tt0944947' }, episodes: {} }
            : { info: { name: 'The Matrix', releasedate: '1999-03-31' } })));
    }
    return nativeFetch(url, { ...options, signal: options?.signal || AbortSignal.timeout(20000) });
};

async function main() {
    const addons = await (await fetch('https://raw.githubusercontent.com/Stremio/stremio-official-addons/master/index.json')).json();
    const installed = addons.filter((addon) => ['org.stremio.opensubtitlesv3', 'com.linvo.cinemeta'].includes(addon.manifest.id));
    assert.equal(installed.length, 2);
    const { loadXtreamSubtitles } = require('../src/routes/Addons/XtreamAddon/xtreamSubtitles');
    for (const [type, videoId] of [['movie', 'xc_smoke_vod_1'], ['series', 'xc_smoke_series_1:1:1:23:mp4']]) {
        const tracks = [];
        await loadXtreamSubtitles({ type, videoId, addons: installed, onTracks: (batch) => tracks.push(...batch) });
        assert.ok(tracks.length > 0, `No tracks for ${type}`);
        assert.ok(tracks.every((track) => track.origin === 'OpenSubtitles v3'));
        const spanish = tracks.filter((track) => track.lang === 'spa');
        assert.ok(spanish.length > 0, `No Spanish tracks for ${type}`);
        const response = await fetch(spanish[0].url);
        assert.ok(response.ok, `Subtitle download failed: ${response.status}`);
        assert.match(await response.text(), /-->/, 'Subtitle file must contain timed cues');
        console.log(JSON.stringify({ type, tracks: tracks.length, spanish: spanish.length, download: 'OK' }));
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
}).finally(() => { global.fetch = nativeFetch; });
