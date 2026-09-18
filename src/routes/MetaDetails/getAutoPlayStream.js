// Only use sources for the requested episode: the model may still contain the previous one while loading.
const getAutoPlayStream = (metaDetails, { type, id, videoId }) => {
    if (!videoId || metaDetails.selected?.metaPath?.type !== type ||
        metaDetails.selected?.metaPath?.id !== id ||
        metaDetails.selected?.streamPath?.id !== videoId) {
        return null;
    }

    for (const streams of metaDetails.streams) {
        if (streams.content.type !== 'Ready') {
            continue;
        }
        const stream = streams.content.content.find((stream) => (
            typeof stream.deepLinks?.player === 'string' && stream.deepLinks.player.length > 0 &&
            !stream.deepLinks.externalPlayer?.web && !stream.deepLinks.externalPlayer?.openPlayer
        ));
        if (stream) {
            return stream;
        }
    }
    return null;
};

module.exports = getAutoPlayStream;
