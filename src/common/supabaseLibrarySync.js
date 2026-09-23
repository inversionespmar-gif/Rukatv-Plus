// RukaTv - Supabase Personal Library & Settings Sync Engine
// Handles bidirectional synchronization for Biblioteca, Continuar Viendo, Calendario & Personal Addons per user account

const supabase = require('./supabase');
const { loadSourcesAsync, saveSourceAsync } = require('../routes/Addons/XtreamAddon/xtreamStorage');
const { generateManifest } = require('../routes/Addons/XtreamAddon/xtreamAddon');

let isSyncing = false;
let previousSettingsStr = '';
const previousLibraryMap = new Map();

/**
 * Download library items from Supabase user_library table and sync into Stremio Core
 */
async function pullLibraryFromSupabase(userId, core) {
    if (!supabase || !userId || !core) return;
    try {
        const { data: rows, error } = await supabase
            .from('user_library')
            .select('*')
            .eq('user_id', userId);

        if (error) {
            console.warn('[SupabaseSync] user_library fetch warning:', error.message);
            return;
        }

        if (Array.isArray(rows) && rows.length > 0) {
            isSyncing = true;
            for (const item of rows) {
                const metaItem = {
                    _id: item.item_id,
                    id: item.item_id,
                    type: item.type,
                    name: item.name,
                    poster: item.poster,
                    posterShape: item.poster_shape || 'poster',
                    state: item.state || {},
                    mtime: item.mtime
                };
                previousLibraryMap.set(item.item_id, JSON.stringify(item.state || {}));

                if (core.transport) {
                    // 1. Add item to Stremio Core Library
                    core.transport.dispatch({
                        action: 'Ctx',
                        args: {
                            action: 'AddToLibrary',
                            args: metaItem
                        }
                    });

                    // 2. Restore exact playback state (timeOffset, watched, lastWatched, video_id, etc.) for Continue Watching
                    if (item.state && Object.keys(item.state).length > 0) {
                        core.transport.dispatch({
                            action: 'Ctx',
                            args: {
                                action: 'UpdateLibraryItemState',
                                args: [
                                    item.item_id,
                                    item.state
                                ]
                            }
                        });
                    }
                }
            }
            setTimeout(() => { isSyncing = false; }, 2500);
        }
    } catch (err) {
        console.warn('[SupabaseSync] Failed to pull library from Supabase:', err);
    }
}

/**
 * Download settings and installed Xtream sources from Supabase user_settings table
 */
async function pullSettingsFromSupabase(userId, core) {
    if (!supabase || !userId) return;
    try {
        const { data, error } = await supabase
            .from('user_settings')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            console.warn('[SupabaseSync] user_settings fetch warning:', error.message);
            return;
        }

        if (data) {
            if (data.settings && core && core.transport) {
                previousSettingsStr = JSON.stringify(data.settings);
                core.transport.dispatch({
                    action: 'Ctx',
                    args: {
                        action: 'UpdateSettings',
                        args: data.settings
                    }
                });
            }

            if (Array.isArray(data.addons)) {
                for (const source of data.addons) {
                    await saveSourceAsync(source);
                    if (core && core.transport) {
                        const manifest = generateManifest(source);
                        const transportUrl = `https://xtream.internal/${source.id}/manifest.json`;
                        const addonDescriptor = {
                            transportUrl,
                            manifest,
                            flags: { official: false, protected: false }
                        };
                        core.transport.dispatch({
                            action: 'Ctx',
                            args: {
                                action: 'InstallAddon',
                                args: addonDescriptor
                            }
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.warn('[SupabaseSync] Failed to pull settings from Supabase:', err);
    }
}

/**
 * Push single item change to Supabase user_library
 */
async function syncItemToSupabase(userId, item) {
    const id = (item && (item._id || item.id)) || '';
    if (!supabase || !userId || !item || !id) return;
    try {
        await supabase.from('user_library').upsert({
            id: `${userId}_${id}`,
            user_id: userId,
            item_id: id,
            type: item.type || 'movie',
            name: item.name || '',
            poster: item.poster || '',
            poster_shape: item.posterShape || item.poster_shape || 'poster',
            state: item.state || {},
            mtime: item._mtime || item.mtime ? new Date(item._mtime || item.mtime).toISOString() : new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    } catch (err) {
        console.warn('[SupabaseSync] Failed to upsert item to Supabase:', err);
    }
}

/**
 * Delete item from Supabase user_library
 */
async function removeItemFromSupabase(userId, itemId) {
    if (!supabase || !userId || !itemId) return;
    try {
        await supabase.from('user_library').delete().match({ user_id: userId, item_id: itemId });
    } catch (err) {
        console.warn('[SupabaseSync] Failed to delete item from Supabase:', err);
    }
}

/**
 * Save user settings and Xtream sources / addons to Supabase
 */
async function pushSettingsToSupabase(userId, settings) {
    if (!supabase || !userId) return;
    try {
        const sources = await loadSourcesAsync();
        const payload = {
            user_id: userId,
            addons: sources,
            updated_at: new Date().toISOString()
        };
        if (settings) {
            payload.settings = settings;
        }
        await supabase.from('user_settings').upsert(payload);
    } catch (err) {
        console.warn('[SupabaseSync] Failed to push settings to Supabase:', err);
    }
}

/**
 * Save current user Xtream sources / addons to Supabase
 */
async function pushXtreamSourcesToSupabase(userId) {
    if (!supabase || !userId) return;
    try {
        const sources = await loadSourcesAsync();
        await supabase.from('user_settings').upsert({
            user_id: userId,
            addons: sources,
            updated_at: new Date().toISOString()
        });
    } catch (err) {
        console.warn('[SupabaseSync] Failed to push sources to Supabase:', err);
    }
}

/**
 * Initialize bidirectional synchronization for authenticated user
 */
function initSupabaseSync(userId, core) {
    if (!supabase || !userId || !core) return () => {};

    // 1. Pull data on startup/login
    pullLibraryFromSupabase(userId, core);
    pullSettingsFromSupabase(userId, core);

    // 2. Listen to core state events to detect updates
    const onState = async (models) => {
        // models is an array of updated model names from core, e.g. ['ctx'] or ['library']
        if (isSyncing || !Array.isArray(models)) return;

        const isRelevant = models.indexOf('ctx') !== -1 ||
                           models.indexOf('library') !== -1 ||
                           models.indexOf('profile') !== -1 ||
                           models.indexOf('player') !== -1;

        if (!isRelevant) return;

        try {
            const ctx = await core.transport.getState('ctx');
            if (!ctx || !ctx.profile) return;

            // Sync Settings if changed
            if (ctx.profile.settings) {
                const settingsStr = JSON.stringify(ctx.profile.settings);
                if (previousSettingsStr !== settingsStr) {
                    previousSettingsStr = settingsStr;
                    pushSettingsToSupabase(userId, ctx.profile.settings);
                }
            }

            // Sync Library & Continue Watching items
            const rawLibrary = ctx.profile.library;
            let currentItems = [];
            if (Array.isArray(rawLibrary)) {
                currentItems = rawLibrary;
            } else if (rawLibrary && typeof rawLibrary === 'object') {
                currentItems = Object.values(rawLibrary.items || rawLibrary);
            }

            const currentIds = new Set();
            for (const item of currentItems) {
                const id = item._id || item.id;
                if (!id) continue;

                const isRemoved = item.removed === 1 || item.removed === true || item.temp === true;
                if (isRemoved) {
                    if (previousLibraryMap.has(id)) {
                        previousLibraryMap.delete(id);
                        removeItemFromSupabase(userId, id);
                    }
                    continue;
                }

                currentIds.add(id);
                const stateStr = JSON.stringify(item.state || {});
                const prevStr = previousLibraryMap.get(id);

                if (prevStr !== stateStr) {
                    previousLibraryMap.set(id, stateStr);
                    syncItemToSupabase(userId, item);
                }
            }

            // Check for deleted items no longer in currentItems
            for (const [id] of previousLibraryMap.entries()) {
                if (!currentIds.has(id)) {
                    previousLibraryMap.delete(id);
                    removeItemFromSupabase(userId, id);
                }
            }
        } catch (e) {
            console.warn('[SupabaseSync] Error processing state change:', e);
        }
    };

    if (core.on) {
        core.on('state', onState);
    }

    return () => {
        if (core.off) {
            core.off('state', onState);
        }
        previousLibraryMap.clear();
        previousSettingsStr = '';
    };
}

module.exports = {
    pullLibraryFromSupabase,
    pullSettingsFromSupabase,
    syncItemToSupabase,
    removeItemFromSupabase,
    pushSettingsToSupabase,
    pushXtreamSourcesToSupabase,
    initSupabaseSync
};
