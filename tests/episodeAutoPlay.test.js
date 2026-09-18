const getAutoPlayStream = require('../src/routes/MetaDetails/getAutoPlayStream');

const episode = { type: 'series', id: 'show', videoId: 'show:1:2' };
const playable = { deepLinks: { player: '#/player/episode-2' } };
const ready = (...streams) => ({ content: { type: 'Ready', content: streams } });
const model = (streams) => ({
    selected: { metaPath: { type: 'series', id: 'show' }, streamPath: { id: 'show:1:2' } },
    streams
});

test('starts an available episode without waiting for other addons', () => {
    expect(getAutoPlayStream(model([
        { content: { type: 'Loading' } }, ready(playable)
    ]), episode)).toBe(playable);
});

test('never plays the previous episode or another series while the model updates', () => {
    expect(getAutoPlayStream(model([ready(playable)]), { ...episode, videoId: 'show:1:3' })).toBeNull();
    expect(getAutoPlayStream(model([ready(playable)]), { ...episode, id: 'other' })).toBeNull();
    expect(getAutoPlayStream(model([ready(playable)]), { ...episode, type: 'movie' })).toBeNull();
    expect(getAutoPlayStream({ selected: null, streams: [] }, episode)).toBeNull();
});

test('keeps source selection available if addons fail, are empty, or still loading', () => {
    for (const streams of [[], [ready()], [{ content: { type: 'Err' } }], [{ content: { type: 'Loading' } }]]) {
        expect(getAutoPlayStream(model(streams), episode)).toBeNull();
    }
});

test('skips external-only sources and chooses the first internal player source', () => {
    expect(getAutoPlayStream(model([ready(
        { deepLinks: { externalPlayer: { web: 'https://example.com' } } },
        { deepLinks: { player: '#/player/external', externalPlayer: { openPlayer: { android: 'external:' } } } },
        { deepLinks: { player: '' } },
        playable,
        { deepLinks: { player: '#/player/alternative' } }
    )]), episode)).toBe(playable);
});
