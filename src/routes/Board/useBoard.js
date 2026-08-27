// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useCore } = require('rukautv/core');
const { useModelState } = require('rukautv/common');

const useBoard = () => {
    const core = useCore();
    const action = React.useMemo(() => ({
        action: 'Load',
        args: {
            model: 'CatalogsWithExtra',
            args: { extra: [] }
        }
    }), []);
    const loadRange = React.useCallback((range) => {
        core.transport.dispatch({
            action: 'CatalogsWithExtra',
            args: {
                action: 'LoadRange',
                args: range
            }
        }, 'board');
    }, []);
    const board = useModelState({ model: 'board', action });
    const filteredBoard = React.useMemo(() => {
        if (!board || !Array.isArray(board.catalogs)) {
            return board;
        }
        return {
            ...board,
            catalogs: board.catalogs.filter((catalog) => {
                const addonId = (catalog && catalog.addon && catalog.addon.manifest && catalog.addon.manifest.id) || '';
                const transportUrl = (catalog && catalog.addon && catalog.addon.transportUrl) || (catalog && catalog.request && catalog.request.base) || '';
                const isCinemeta = addonId.toLowerCase().includes('cinemeta') ||
                                   transportUrl.toLowerCase().includes('cinemeta') ||
                                   transportUrl.toLowerCase().includes('stremio.com');
                return !isCinemeta;
            })
        };
    }, [board]);
    return [filteredBoard, loadRange];
};

module.exports = useBoard;
