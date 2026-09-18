// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useCore } = require('rukautv/core');
const { useModelState } = require('rukautv/common');
const { getSearchCatalogs, getCoreSearchRange } = require('./searchCatalogs');

const useSearch = (queryParams) => {
    const core = useCore();
    // TODO: refactor this to be in rukautv-core-web
    // React.useEffect(() => {
    //     let timerId = setTimeout(emitSearchEvent, 500);
    //     function emitSearchEvent() {
    //         timerId = null;
    //         const state = core.transport.getState('search');
    //         if (state.selected !== null) {
    //             const [, query] = state.selected.extra.find(([name]) => name === 'search');
    //             const responses = state.catalogs.filter((catalog) => catalog.content?.type === 'Ready');
    //             core.transport.analytics({
    //                 event: 'Search',
    //                 args: {
    //                     query,
    //                     responsesCount: responses.length
    //                 }
    //             });
    //         }
    //     }
    //     return () => {
    //         if (timerId !== null) {
    //             clearTimeout(timerId);
    //             emitSearchEvent();
    //         }
    //     };
    // }, [queryParams.get('search')]);
    const action = React.useMemo(() => {
        const query = queryParams.get('search') ?? queryParams.get('query');
        if (query?.length > 0) {
            return {
                action: 'Load',
                args: {
                    model: 'CatalogsWithExtra',
                    args: {
                        extra: [
                            ['search', query]
                        ]
                    }
                }
            };
        } else {
            return {
                action: 'Unload'
            };
        }
    }, [queryParams]);
    const search = useModelState({ model: 'search', action });
    const visible = React.useMemo(() => getSearchCatalogs(search?.catalogs || []), [search?.catalogs]);
    const loadRange = React.useCallback((range) => {
        const coreRange = getCoreSearchRange(visible.indices, range);
        if (!coreRange) return;
        core.transport.dispatch({
            action: 'CatalogsWithExtra',
            args: {
                action: 'LoadRange',
                args: coreRange
            }
        }, 'search');
    }, [core, visible]);
    const filteredSearch = React.useMemo(() => {
        if (!search || !Array.isArray(search.catalogs)) {
            return search;
        }
        return {
            ...search,
            catalogs: visible.catalogs,
            hasSearchAddons: visible.hasSearchAddons
        };
    }, [search, visible]);
    return [filteredSearch, loadRange];
};

module.exports = useSearch;
