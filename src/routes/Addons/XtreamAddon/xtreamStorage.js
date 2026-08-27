// RukaTv - Xtream Storage Helper (IndexedDB + localStorage fallback)
// Works seamlessly in both Main Window Thread and Web Worker Thread

const DB_NAME = 'rukatv_db';
const STORE_NAME = 'xtream_sources';
const LOCAL_STORAGE_KEY = 'rukatv_xtream_sources';

function openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            return reject(new Error('IndexedDB not supported'));
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all Xtream sources (from IndexedDB or localStorage)
 */
async function loadSourcesAsync() {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve(loadSourcesLocalStorage());
        });
    } catch (_e) {
        return loadSourcesLocalStorage();
    }
}

/**
 * Save an Xtream source to IndexedDB and localStorage
 */
async function saveSourceAsync(source) {
    saveSourceLocalStorage(source);
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(source);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (_e) {
        // Fallback already saved in localStorage
    }
}

/**
 * Remove an Xtream source
 */
async function removeSourceAsync(id) {
    removeSourceLocalStorage(id);
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    } catch (_e) {
        // Fallback handled
    }
}

// Synchronous localStorage fallbacks for main thread
function loadSourcesLocalStorage() {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_e) {
        return [];
    }
}

function saveSourceLocalStorage(source) {
    if (typeof localStorage === 'undefined') return;
    try {
        const sources = loadSourcesLocalStorage();
        const idx = sources.findIndex((s) => s.id === source.id);
        if (idx >= 0) sources[idx] = source;
        else sources.push(source);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sources));
    } catch (_e) {
        // ignore
    }
}

function removeSourceLocalStorage(id) {
    if (typeof localStorage === 'undefined') return;
    try {
        const sources = loadSourcesLocalStorage().filter((s) => s.id !== id);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sources));
    } catch (_e) {
        // ignore
    }
}

module.exports = {
    loadSourcesAsync,
    saveSourceAsync,
    removeSourceAsync,
    loadSourcesLocalStorage
};
