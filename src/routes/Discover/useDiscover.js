// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const UrlUtils = require('url');
const { useCore } = require('rukautv/core');
const { useModelState } = require('rukautv/common');

const map = (discover) => {
    if (!discover) return discover;
    let selectable = discover.selectable;
    if (selectable && Array.isArray(selectable.catalogs)) {
        selectable = {
            ...selectable,
            catalogs: selectable.catalogs.filter(({ addon }) => {
                const addonId = (addon && addon.manifest && addon.manifest.id) || '';
                const transportUrl = (addon && addon.transportUrl) || '';
                const isCinemeta = addonId.toLowerCase().includes('cinemeta') ||
                                   transportUrl.toLowerCase().includes('cinemeta') ||
                                   transportUrl.toLowerCase().includes('stremio.com');
                return !isCinemeta;
            })
        };
    }
    return {
        ...discover,
        selectable,
        catalog: discover.catalog !== null && discover.catalog.content.type === 'Ready' ?
            {
                ...discover.catalog,
                content: {
                    ...discover.catalog.content,
                    content: discover.catalog.content.content.map((metaItem) => ({
                        ...metaItem,
                        released: new Date(typeof metaItem.released === 'string' ? metaItem.released : NaN),
                    }))
                }
            }
            :
            discover.catalog
    };
};

const useDiscover = (urlParams, queryParams) => {
    const core = useCore();
    const loadNextPage = React.useCallback(() => {
        core.transport.dispatch({
            action: 'CatalogWithFilters',
            args: {
                action: 'LoadNextPage'
            }
        }, 'discover');
    }, []);
    const action = React.useMemo(() => {
        if (typeof urlParams.transportUrl === 'string' && typeof urlParams.type === 'string' && typeof urlParams.catalogId === 'string') {
            const { hostname } = UrlUtils.parse(urlParams.transportUrl);
            if (typeof hostname === 'string' && hostname.length > 0) {
                return {
                    action: 'Load',
                    args: {
                        model: 'CatalogWithFilters',
                        args: {
                            request: {
                                base: urlParams.transportUrl,
                                path: {
                                    resource: 'catalog',
                                    type: urlParams.type,
                                    id: urlParams.catalogId,
                                    extra: Array.from(queryParams.entries())
                                }
                            }
                        }
                    }
                };
            }
        } else {
            return {
                action: 'Load',
                args: {
                    model: 'CatalogWithFilters',
                    args: null
                }
            };
        }

        return {
            action: 'Unload'
        };
    }, [urlParams, queryParams]);
    const discover = useModelState({ model: 'discover', action, map, deps: ['ctx'] });
    return [discover, loadNextPage];
};

module.exports = useDiscover;
