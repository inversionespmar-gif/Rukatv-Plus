const React = require('react');
const { renderToString } = require('react-dom/server');

jest.mock('rukautv/common', () => ({ useProfile: () => ({ addons: [] }) }), { virtual: true });
const useXtreamSubtitles = require('../src/routes/Player/useXtreamSubtitles');

function PlayerSubtitleProbe({ player }) {
    const tracks = useXtreamSubtitles(player);
    return React.createElement('span', null, `tracks:${tracks.length}`);
}

test.each([
    { selected: null, metaItem: null },
    { selected: { stream: {} }, metaItem: null },
    { selected: { streamRequest: { path: { type: 'series', id: 'xc_test_series_1:1:1' } } }, metaItem: { type: 'Loading' } }
])('mounts the player before its stream and subtitles are loaded: %j', (player) => {
    expect(renderToString(React.createElement(PlayerSubtitleProbe, { player }))).toBe('<span>tracks:0</span>');
});
