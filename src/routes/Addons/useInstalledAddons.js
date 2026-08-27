// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useModelState } = require('rukautv/common');

const useInstalledAddons = (urlParams) => {
    const action = React.useMemo(() => {
        if (typeof urlParams.transportUrl !== 'string' && typeof urlParams.catalogId !== 'string') {
            return {
                action: 'Load',
                args: {
                    model: 'InstalledAddonsWithFilters',
                    args: {
                        request: {
                            type: typeof urlParams.type === 'string' ? urlParams.type : null
                        }
                    }
                }
            };
        } else {
            return {
                action: 'Unload'
            };
        }
    }, [urlParams]);
    const installedAddons = useModelState({ model: 'installed_addons', action });
    return React.useMemo(() => {
        if (!installedAddons || !Array.isArray(installedAddons.catalog)) {
            return installedAddons;
        }
        return {
            ...installedAddons,
            catalog: installedAddons.catalog.filter((addon) => {
                const id = (addon && addon.manifest && addon.manifest.id) || '';
                const name = (addon && addon.manifest && addon.manifest.name) || '';
                const transportUrl = (addon && addon.transportUrl) || '';
                const isCinemeta = id.toLowerCase().includes('cinemeta') || transportUrl.toLowerCase().includes('cinemeta');
                const isLocalFiles = transportUrl.toLowerCase().includes('local-addon') || transportUrl.toLowerCase().includes('11470') || id.toLowerCase().includes('local-addon') || name.toLowerCase().includes('local files');
                return !isCinemeta && !isLocalFiles;
            })
        };
    }, [installedAddons]);
};

module.exports = useInstalledAddons;
