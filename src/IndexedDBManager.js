// IndexedDBManager.js
// Provides IndexedDB persistence for the serverless version
// Stores user settings, saved files, and cached data

const DB_NAME = 'SitrecDB';
const DB_VERSION = 1;

// Store names
const STORES = {
    SETTINGS: 'settings',
    FILES: 'files',
    CACHE: 'cache'
};

class IndexedDBManager {
    constructor() {
        this.db = null;
        this.initialized = false;
    }

    /**
     * Initialize IndexedDB connection
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
        if (this.initialized && this.db) {
            return this.db;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('IndexedDB failed to open:', request.error);
                reject(new Error('IndexedDB failed to open: ' + request.error));
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.initialized = true;
                console.log('IndexedDB initialized');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object stores if they don't exist
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                }

                if (!db.objectStoreNames.contains(STORES.FILES)) {
                    const fileStore = db.createObjectStore(STORES.FILES, { keyPath: 'id', autoIncrement: true });
                    fileStore.createIndex('filename', 'filename', { unique: false });
                    fileStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORES.CACHE)) {
                    const cacheStore = db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
                    cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                console.log('IndexedDB stores created/updated');
            };
        });
    }

    /**
     * Get a setting by key
     * @param {string} key
     * @returns {Promise<any>}
     */
    async getSetting(key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.SETTINGS], 'readonly');
            const store = transaction.objectStore(STORES.SETTINGS);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result?.value || null);
            };

            request.onerror = () => {
                reject(new Error('Failed to get setting: ' + request.error));
            };
        });
    }

    /**
     * Get all settings
     * @returns {Promise<Object>}
     */
    async getAllSettings() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.SETTINGS], 'readonly');
            const store = transaction.objectStore(STORES.SETTINGS);
            const request = store.getAll();

            request.onsuccess = () => {
                const settings = {};
                request.result.forEach(item => {
                    settings[item.key] = item.value;
                });
                resolve(settings);
            };

            request.onerror = () => {
                reject(new Error('Failed to get all settings: ' + request.error));
            };
        });
    }

    /**
     * Set a setting
     * @param {string} key
     * @param {any} value
     * @returns {Promise<void>}
     */
    async setSetting(key, value) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.SETTINGS], 'readwrite');
            const store = transaction.objectStore(STORES.SETTINGS);
            const request = store.put({ key, value, timestamp: Date.now() });

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                reject(new Error('Failed to set setting: ' + request.error));
            };
        });
    }

    /**
     * Save a file to IndexedDB
     * @param {string} filename
     * @param {Blob|ArrayBuffer} data
     * @param {string} folder - Optional folder path
     * @returns {Promise<number>} File ID
     */
    async saveFile(filename, data, folder = '') {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.FILES], 'readwrite');
            const store = transaction.objectStore(STORES.FILES);
            const request = store.add({
                filename,
                folder,
                data,
                timestamp: Date.now(),
                size: data.size || data.byteLength || 0
            });

            request.onsuccess = () => {
                console.log('File saved to IndexedDB:', filename);
                resolve(request.result);
            };

            request.onerror = () => {
                reject(new Error('Failed to save file: ' + request.error));
            };
        });
    }

    /**
     * Get a file from IndexedDB by filename
     * @param {string} filename
     * @returns {Promise<Blob|ArrayBuffer|null>}
     */
    async getFile(filename) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.FILES], 'readonly');
            const store = transaction.objectStore(STORES.FILES);
            const index = store.index('filename');
            const request = index.getAll(filename);

            request.onsuccess = () => {
                if (request.result.length > 0) {
                    // Return the most recent version
                    const latest = request.result.sort((a, b) => b.timestamp - a.timestamp)[0];
                    resolve(latest.data);
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => {
                reject(new Error('Failed to get file: ' + request.error));
            };
        });
    }

    /**
     * List all files in a folder
     * @param {string} folder
     * @returns {Promise<Array>}
     */
    async listFiles(folder = '') {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.FILES], 'readonly');
            const store = transaction.objectStore(STORES.FILES);
            const request = store.getAll();

            request.onsuccess = () => {
                const files = request.result
                    .filter(f => f.folder === folder)
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .map(f => ({
                        filename: f.filename,
                        timestamp: f.timestamp,
                        size: f.size,
                        id: f.id
                    }));
                resolve(files);
            };

            request.onerror = () => {
                reject(new Error('Failed to list files: ' + request.error));
            };
        });
    }

    /**
     * Delete a file by ID
     * @param {number} fileId
     * @returns {Promise<void>}
     */
    async deleteFile(fileId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.FILES], 'readwrite');
            const store = transaction.objectStore(STORES.FILES);
            const request = store.delete(fileId);

            request.onsuccess = () => {
                console.log('File deleted from IndexedDB:', fileId);
                resolve();
            };

            request.onerror = () => {
                reject(new Error('Failed to delete file: ' + request.error));
            };
        });
    }

    /**
     * Cache data (e.g., TLE data from Celestrak)
     * @param {string} key
     * @param {any} data
     * @param {number} ttl - Time to live in milliseconds
     * @returns {Promise<void>}
     */
    async cacheData(key, data, ttl = 3600000) { // 1 hour default
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.CACHE], 'readwrite');
            const store = transaction.objectStore(STORES.CACHE);
            const request = store.put({
                key,
                data,
                timestamp: Date.now(),
                expires: Date.now() + ttl
            });

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                reject(new Error('Failed to cache data: ' + request.error));
            };
        });
    }

    /**
     * Get cached data
     * @param {string} key
     * @returns {Promise<any|null>}
     */
    async getCachedData(key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.CACHE], 'readonly');
            const store = transaction.objectStore(STORES.CACHE);
            const request = store.get(key);

            request.onsuccess = () => {
                const item = request.result;
                if (!item) {
                    resolve(null);
                    return;
                }

                // Check if cache has expired
                if (item.expires < Date.now()) {
                    // Delete expired cache entry
                    this.deleteCache(key).catch(console.error);
                    resolve(null);
                } else {
                    resolve(item.data);
                }
            };

            request.onerror = () => {
                reject(new Error('Failed to get cached data: ' + request.error));
            };
        });
    }

    /**
     * Delete cache entry
     * @param {string} key
     * @returns {Promise<void>}
     */
    async deleteCache(key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.CACHE], 'readwrite');
            const store = transaction.objectStore(STORES.CACHE);
            const request = store.delete(key);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                reject(new Error('Failed to delete cache: ' + request.error));
            };
        });
    }

    /**
     * Clear all cached data
     * @returns {Promise<void>}
     */
    async clearCache() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.CACHE], 'readwrite');
            const store = transaction.objectStore(STORES.CACHE);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('Cache cleared');
                resolve();
            };

            request.onerror = () => {
                reject(new Error('Failed to clear cache: ' + request.error));
            };
        });
    }

    /**
     * Get database statistics
     * @returns {Promise<Object>}
     */
    async getStats() {
        await this.init();
        const settingsCount = await new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.SETTINGS], 'readonly');
            const store = transaction.objectStore(STORES.SETTINGS);
            const request = store.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const filesData = await new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.FILES], 'readonly');
            const store = transaction.objectStore(STORES.FILES);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const totalFileSize = filesData.reduce((sum, f) => sum + (f.size || 0), 0);

        return {
            settingsCount,
            filesCount: filesData.length,
            totalFileSize,
            totalFileSizeMB: (totalFileSize / 1024 / 1024).toFixed(2)
        };
    }
}

// Create singleton instance
export const indexedDBManager = new IndexedDBManager();