// RukaTv - Supabase Personal Library & Settings Sync Engine
// Handles bidirectional synchronization for Biblioteca, Continuar Viendo, Calendario & Personal Addons per user account

const supabase = require('./supabase');
const { loadSourcesAsync, saveSourceAsync } = require('../routes/Addons/XtreamAddon/xtreamStorage');
const { generateManifest } = require('../routes/Addons/XtreamAddon/xtreamAddon');

let isSyncing = false;
let previousSettingsStr = '';
const previousLibraryMap = new Map();
let originalDispatch = null;

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
        console.warn('[SupabaseSync] Failed to upsert item to Supabase:', err.message || err);
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
        console.warn('[SupabaseSync] Failed to delete item from Supabase:', err.message || err);
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
        console.warn('[SupabaseSync] Failed to push settings to Supabase:', err.message || err);
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
        console.warn('[SupabaseSync] Failed to push sources to Supabase:', err.message || err);
    }
}

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

                    // 2. Restore exact playback state (timeOffset, watched, lastWatched, video_id, etc.)
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

            // Force reload continue_watching_preview and library models in core
            if (core.transport) {
                core.transport.dispatch({
                    action: 'Load',
                    args: { model: 'continue_watching_preview', args: null }
                });
            }

            setTimeout(() => { isSyncing = false; }, 3000);
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
 * Inspect continue_watching_preview and library models from core and sync items
 */
async function syncCoreLibraryState(userId, core) {
    if (!core || !core.transport || isSyncing) return;
    try {
        // 1. Fetch continue_watching_preview items
        const cwState = await core.transport.getState('continue_watching_preview').catch(() => null);
        if (cwState && Array.isArray(cwState.items)) {
            for (const item of cwState.items) {
                const id = item._id || item.id;
                if (!id) continue;
                const stateStr = JSON.stringify(item.state || {});
                if (previousLibraryMap.get(id) !== stateStr) {
                    previousLibraryMap.set(id, stateStr);
                    syncItemToSupabase(userId, item);
                }
            }
        }

        // 2. Fetch Ctx settings
        const ctxState = await core.transport.getState('ctx').catch(() => null);
        if (ctxState && ctxState.profile && ctxState.profile.settings) {
            const settingsStr = JSON.stringify(ctxState.profile.settings);
            if (previousSettingsStr !== settingsStr) {
                previousSettingsStr = settingsStr;
                pushSettingsToSupabase(userId, ctxState.profile.settings);
            }
        }
    } catch (_e) {
        // ignore fetch failures
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

    // 2. Intercept dispatch calls to capture AddToLibrary, RemoveFromLibrary, MetaItemMarkAsWatched, UpdateLibraryItemState
    if (core.transport && core.transport.dispatch && !originalDispatch) {
        originalDispatch = core.transport.dispatch;
        core.transport.dispatch = function (action, model) {
            const result = originalDispatch.apply(this, arguments);

            if (action && action.action === 'Ctx' && action.args) {
                const subAction = action.args.action;
                const subArgs = action.args.args;

                if (subAction === 'AddToLibrary' && subArgs) {
                    syncItemToSupabase(userId, subArgs);
                } else if (subAction === 'RemoveFromLibrary' && subArgs) {
                    const itemId = typeof subArgs === 'string' ? subArgs : (subArgs.id || subArgs._id);
                    removeItemFromSupabase(userId, itemId);
                } else if (subAction === 'MetaItemMarkAsWatched' && subArgs && subArgs.meta_item) {
                    const item = subArgs.meta_item;
                    const isWatched = subArgs.is_watched;
                    const updatedItem = {
                        ...item,
                        state: {
                            ...(item.state || {}),
                            watched: isWatched ? new Date().toISOString() : null,
                            timesWatched: isWatched ? ((item.state?.timesWatched || 0) + 1) : 0,
                            flaggedWatched: isWatched ? 1 : 0
                        }
                    };
                    syncItemToSupabase(userId, updatedItem);
                } else if (subAction === 'UpdateLibraryItemState' && Array.isArray(subArgs)) {
                    const [itemId, newState] = subArgs;
                    syncItemToSupabase(userId, { id: itemId, state: newState });
                } else if (subAction === 'UpdateSettings' && subArgs) {
                    pushSettingsToSupabase(userId, subArgs);
                }
            }

            return result;
        };
    }

    // 3. Listen to core state events and periodically sync active video progress & continue watching
    const onState = () => {
        syncCoreLibraryState(userId, core);
    };

    if (core.on) {
        core.on('state', onState);
    }

    // Interval fallback every 5 seconds during active usage
    const intervalId = setInterval(() => {
        syncCoreLibraryState(userId, core);
    }, 5000);

    return () => {
        if (core.off) {
            core.off('state', onState);
        }
        clearInterval(intervalId);
        if (originalDispatch && core.transport) {
            core.transport.dispatch = originalDispatch;
            originalDispatch = null;
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
