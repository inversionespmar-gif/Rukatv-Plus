// RukaTv - Supabase Personal Library & Settings Sync Engine
// Handles bidirectional synchronization for Biblioteca, Continuar Viendo, Calendario & Personal Addons per user account

const supabase = require('./supabase');
const { loadSourcesAsync, saveSourceAsync } = require('../routes/Addons/XtreamAddon/xtreamStorage');
const { generateManifest } = require('../routes/Addons/XtreamAddon/xtreamAddon');

let isSyncing = false;
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
                    core.transport.dispatch({
                        action: 'Ctx',
                        args: {
                            action: 'AddToLibrary',
                            args: metaItem
                        }
                    });
                }
            }
            setTimeout(() => { isSyncing = false; }, 2000);
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

        if (data && Array.isArray(data.addons)) {
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
    } catch (err) {
        console.warn('[SupabaseSync] Failed to pull settings from Supabase:', err);
    }
}

/**
 * Push single item change to Supabase user_library
 */
async function syncItemToSupabase(userId, item) {
    if (!supabase || !userId || !item || !item.id) return;
    try {
        await supabase.from('user_library').upsert({
            id: `${userId}_${item.id}`,
            user_id: userId,
            item_id: item.id,
            type: item.type || 'movie',
            name: item.name || '',
            poster: item.poster || '',
            poster_shape: item.posterShape || item.poster_shape || 'poster',
            state: item.state || {},
            mtime: item.mtime ? new Date(item.mtime).toISOString() : new Date().toISOString(),
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

    // 2. Listen to core state events to detect library updates
    const onState = (state) => {
        if (isSyncing || !state || !state.profile || !Array.isArray(state.profile.library)) return;

        const currentItems = state.profile.library;
        const currentIds = new Set(currentItems.map((i) => i.id));

        // Check for removed items
        for (const [id] of previousLibraryMap.entries()) {
            if (!currentIds.has(id)) {
                previousLibraryMap.delete(id);
                removeItemFromSupabase(userId, id);
            }
        }

        // Check for new or updated items
        for (const item of currentItems) {
            const stateStr = JSON.stringify(item.state || {});
            const prevStr = previousLibraryMap.get(item.id);

            if (prevStr !== stateStr) {
                previousLibraryMap.set(item.id, stateStr);
                syncItemToSupabase(userId, item);
            }
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
    };
}

module.exports = {
    pullLibraryFromSupabase,
    pullSettingsFromSupabase,
    syncItemToSupabase,
    removeItemFromSupabase,
    pushXtreamSourcesToSupabase,
    initSupabaseSync
};
