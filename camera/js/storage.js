/**
 * Local Storage Manager for Camera Node (IndexedDB)
 * Stores recorded video clips locally inside browser storage with auto-purge
 */

class CameraStorage {
  constructor() {
    this.dbName = CONFIG.storage.dbName;
    this.storeName = CONFIG.storage.storeName;
    this.maxStorageBytes = CONFIG.storage.maxStorageBytes;
    this.db = null;
  }

  setMaxStorageMB(mb) {
    const val = Number(mb);
    if (val && val > 0) {
      this.maxStorageBytes = val * 1024 * 1024;
      console.log(`[Storage] Max storage set to ${val} MB (${this.maxStorageBytes} bytes)`);
    }
  }

  async getStorageUsage() {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.openCursor();
      let totalBytes = 0;
      let count = 0;

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          totalBytes += cursor.value.size || 0;
          count++;
          cursor.continue();
        } else {
          const maxBytes = this.maxStorageBytes || CONFIG.storage.maxStorageBytes;
          const percent = Math.min(100, Math.round((totalBytes / maxBytes) * 100));
          resolve({
            totalBytes: totalBytes,
            formattedTotal: formatBytes(totalBytes),
            count: count,
            maxBytes: maxBytes,
            maxMB: Math.round(maxBytes / (1024 * 1024)),
            formattedMax: formatBytes(maxBytes),
            percent: percent
          });
        }
      };

      request.onerror = () => resolve({
        totalBytes: 0,
        formattedTotal: '0 B',
        count: 0,
        maxBytes: this.maxStorageBytes || CONFIG.storage.maxStorageBytes,
        maxMB: 500,
        formattedMax: '500 MB',
        percent: 0
      });
    });
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('trigger', 'trigger', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        console.log('[Storage] IndexedDB initialized');
        resolve();
      };

      request.onerror = (e) => {
        console.error('[Storage] IndexedDB error:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  /**
   * Save a recorded video clip
   * @param {Blob} blob - Video Blob
   * @param {'motion' | 'manual'} trigger - Trigger type
   * @param {number} duration - Clip duration in seconds
   */
  async saveClip(blob, trigger = 'motion', duration = 0) {
    if (!this.db) await this.init();

    // Check circular buffer & purge old clips if needed
    await this.checkAndPurge();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);

      const record = {
        timestamp: Date.now(),
        dateStr: formatDate(Date.now()),
        duration: Math.round(duration),
        size: blob.size,
        mimeType: blob.type || 'video/webm',
        trigger: trigger,
        blob: blob
      };

      const request = store.add(record);

      request.onsuccess = (e) => {
        console.log(`[Storage] Saved clip #${e.target.result} (${formatBytes(blob.size)}, ${record.duration}s, trigger: ${trigger})`);
        resolve(e.target.result);
      };

      request.onerror = (e) => {
        console.error('[Storage] Save error:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  /**
   * List all clips metadata (excluding heavy Blobs for UI speed)
   */
  async listClips() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.openCursor(null, 'prev'); // Newest first
      const clips = [];

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const item = cursor.value;
          clips.push({
            id: item.id,
            timestamp: item.timestamp,
            dateStr: item.dateStr,
            duration: item.duration,
            size: item.size,
            formattedSize: formatBytes(item.size),
            formattedDuration: formatDuration(item.duration),
            trigger: item.trigger,
            mimeType: item.mimeType
          });
          cursor.continue();
        } else {
          resolve(clips);
        }
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get single clip with full Blob
   */
  async getClip(id) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(Number(id));

      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Delete single clip
   */
  async deleteClip(id) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.delete(Number(id));

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Delete all clips
   */
  async clearAll() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Check total storage and purge oldest clips if exceeding limit
   */
  async checkAndPurge(maxBytes = CONFIG.storage.maxStorageBytes) {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.openCursor(); // Oldest first
      let totalSize = 0;
      const allItems = [];

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          totalSize += cursor.value.size || 0;
          allItems.push({ id: cursor.value.id, size: cursor.value.size });
          cursor.continue();
        } else {
          // If total size exceeds max, delete oldest
          if (totalSize > maxBytes) {
            console.log(`[Storage] Exceeded limit (${formatBytes(totalSize)} > ${formatBytes(maxBytes)}). Purging oldest clips...`);
            let freed = 0;
            const deleteTx = this.db.transaction(this.storeName, 'readwrite');
            const delStore = deleteTx.objectStore(this.storeName);

            for (const item of allItems) {
              if (totalSize - freed <= maxBytes * 0.8) break; // Purge down to 80%
              delStore.delete(item.id);
              freed += item.size;
            }
          }
          resolve(totalSize);
        }
      };

      request.onerror = () => resolve(0);
    });
  }
}

window.CameraStorage = CameraStorage;
