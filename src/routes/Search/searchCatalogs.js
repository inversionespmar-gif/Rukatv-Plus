const isSearchAddon = (catalog) => {
    const addonId = catalog.addon?.manifest?.id || '';
    const transportUrl = catalog.addon?.transportUrl || catalog.request?.base || '';
    return !addonId.toLowerCase().includes('cinemeta') &&
        !transportUrl.toLowerCase().includes('cinemeta') &&
        !transportUrl.toLowerCase().includes('stremio.com');
};

const getSearchCatalogs = (catalogs = []) => {
    const supported = catalogs.map((catalog, index) => ({ catalog, index }))
        .filter(({ catalog }) => isSearchAddon(catalog));
    const visible = supported.filter(({ catalog }) => !(
        catalog.content?.type === 'Err' && catalog.content.content === 'EmptyContent' ||
        catalog.content?.type === 'Ready' && catalog.content.content.length === 0
    ));
    return {
        catalogs: visible.map(({ catalog }) => catalog),
        indices: visible.map(({ index }) => index),
        hasSearchAddons: supported.length > 0
    };
};

const getCoreSearchRange = (indices, range) => {
    const start = indices[range?.start];
    const end = indices[range?.end];
    return Number.isInteger(start) && Number.isInteger(end) ? { start, end } : null;
};

module.exports = { getSearchCatalogs, getCoreSearchRange };
