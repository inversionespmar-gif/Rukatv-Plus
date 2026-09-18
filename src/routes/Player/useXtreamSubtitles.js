const React = require('react');
const { useProfile } = require('rukautv/common');
const { loadXtreamSubtitles } = require('../Addons/XtreamAddon/xtreamSubtitles');

const EMPTY_ADDONS = [];
const EMPTY_TRACKS = [];

const useXtreamSubtitles = (player) => {
    const profile = useProfile();
    const addons = profile.addons || EMPTY_ADDONS;
    const path = player.selected?.streamRequest?.path;
    const type = path?.type;
    const videoId = path?.id;
    const name = player.metaItem?.type === 'Ready' ? player.metaItem.content.name : undefined;
    const [result, setResult] = React.useState(null);
    React.useEffect(() => {
        if (!videoId?.startsWith('xc_') || !name) return;
        const controller = new AbortController();
        setResult({ videoId, tracks: [] });
        loadXtreamSubtitles({
            type, videoId, name, addons, signal: controller.signal,
            onTracks: (tracks) => {
                if (controller.signal.aborted) return;
                setResult((previous) => ({ videoId, tracks: previous.tracks.concat(tracks) }));
            }
        }).catch(() => {
            // Subtitle lookup must not interrupt playback when metadata is unavailable.
        });
        return () => controller.abort();
    }, [type, videoId, name, addons]);
    return result?.videoId === videoId ? result.tracks : EMPTY_TRACKS;
};

module.exports = useXtreamSubtitles;
