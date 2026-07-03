/**
 * IndexedDB Service — primary persistence layer for pictos-net
 *
 * v5 schema:
 *   rows    — RowData metadata WITHOUT binary fields (bitmap, rawSvg, structuredSvg)
 *   bitmaps — { libraryId, id, bitmap: base64 data URL } — keyPath: ['libraryId', 'id']
 *   svgs    — { id, rawSvg?, structuredSvg?, libraryId }
 *
 * v4 → v5: bitmaps keyPath changed from 'id' to ['libraryId', 'id'] so that
 * two libraries that happen to share row IDs (e.g. template copies) no longer
 * clobber each other's bitmap entries.
 *
 * localStorage is used only for config (pictonet_v19_config).
 */

const DB_NAME = 'pictonet_storage';
const DB_VERSION = 5;
const STORE_ROWS = 'rows';
const STORE_BITMAPS = 'bitmaps';
const STORE_SVGS = 'svgs';

interface BitmapEntry {
  id: string;
  bitmap: string;
  timestamp: number;
  libraryId: string;
}

interface SvgEntry {
  id: string;
  rawSvg?: string;
  structuredSvg?: string;
  timestamp: number;
  libraryId?: string;
}

let dbInstance: IDBDatabase | null = null;

// ─── DB init ────────────────────────────────────────────────────────────────

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = (event.target as IDBOpenDBRequest).transaction!;
      const oldVersion = event.oldVersion;

      // ── Fresh stores (new database, oldVersion = 0) ──────────────────────────
      if (!db.objectStoreNames.contains(STORE_BITMAPS)) {
        // v5+: compound key so two libraries sharing row IDs don't collide
        const store = db.createObjectStore(STORE_BITMAPS, { keyPath: ['libraryId', 'id'] });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('libraryId', 'libraryId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_SVGS)) {
        const store = db.createObjectStore(STORE_SVGS, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('libraryId', 'libraryId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_ROWS)) {
        const store = db.createObjectStore(STORE_ROWS, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // ── v3 → v4: add libraryId index to svgs store ──────────────────────────
      // (bitmaps migration is handled entirely in v5 below; skip here to avoid
      // tagging entries we are about to discard anyway)
      if (oldVersion >= 1 && oldVersion < 4 && db.objectStoreNames.contains(STORE_SVGS)) {
        const svgStore = transaction.objectStore(STORE_SVGS);
        if (!svgStore.indexNames.contains('libraryId')) {
          svgStore.createIndex('libraryId', 'libraryId', { unique: false });
        }
        const svgCursor = svgStore.openCursor();
        svgCursor.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor) return;
          if (!cursor.value.libraryId) {
            cursor.update({ ...cursor.value, libraryId: 'migrated' });
          }
          cursor.continue();
        };
      }

      // ── v4 → v5: recreate bitmaps with compound keyPath ['libraryId', 'id'] ─
      // Existing entries keyed only by 'id' caused template libraries with
      // shared row IDs to clobber each other's bitmaps.  Recreate the store
      // and preserve any entries that already carry a valid libraryId.
      if (oldVersion >= 1 && oldVersion < 5 && db.objectStoreNames.contains(STORE_BITMAPS)) {
        const oldBitmapStore = transaction.objectStore(STORE_BITMAPS);
        const getAllReq = oldBitmapStore.getAll();
        getAllReq.onsuccess = () => {
          const existing = (getAllReq.result as BitmapEntry[]).filter(
            e => e.libraryId && e.id && e.libraryId !== 'migrated',
          );
          db.deleteObjectStore(STORE_BITMAPS);
          const newStore = db.createObjectStore(STORE_BITMAPS, { keyPath: ['libraryId', 'id'] });
          newStore.createIndex('timestamp', 'timestamp', { unique: false });
          newStore.createIndex('libraryId', 'libraryId', { unique: false });
          existing.forEach(entry => {
            try { newStore.put(entry); } catch (_) { /* skip duplicates */ }
          });
        };
        // If read fails just recreate empty — bitmaps are re-fetched from templates
        getAllReq.onerror = () => {
          db.deleteObjectStore(STORE_BITMAPS);
          const newStore = db.createObjectStore(STORE_BITMAPS, { keyPath: ['libraryId', 'id'] });
          newStore.createIndex('timestamp', 'timestamp', { unique: false });
          newStore.createIndex('libraryId', 'libraryId', { unique: false });
        };
      }
    };
  });
};

// ─── Rows ────────────────────────────────────────────────────────────────────

/**
 * Save all rows atomically (clears existing, then writes all).
 * Rows must not include binary fields (bitmap, rawSvg, structuredSvg).
 */
export const saveRows = async (rows: object[]): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_ROWS], 'readwrite');
    const store = transaction.objectStore(STORE_ROWS);

    const clearReq = store.clear();
    clearReq.onsuccess = () => {
      const now = Date.now();
      rows.forEach((row: any) => {
        store.put({ ...row, timestamp: now });
      });
    };
    clearReq.onerror = () => reject(clearReq.error);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Get all rows from IndexedDB (without binary fields).
 */
export const getAllRows = async (): Promise<object[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_ROWS], 'readonly');
    const store = transaction.objectStore(STORE_ROWS);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Delete a single row by id.
 */
export const deleteRow = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_ROWS], 'readwrite');
    const store = transaction.objectStore(STORE_ROWS);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Clear all rows (used by clearAll).
 */
export const clearAllRows = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_ROWS], 'readwrite');
    const store = transaction.objectStore(STORE_ROWS);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// ─── Bitmaps ─────────────────────────────────────────────────────────────────

/**
 * Compress a PNG data-URL to JPEG for storage.
 * Skips if the bitmap is already JPEG.
 */
const compressForStorage = (dataUrl: string, quality = 0.75): Promise<string> => {
  if (dataUrl.startsWith('data:image/jpeg')) return Promise.resolve(dataUrl);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

/**
 * Save all bitmaps atomically in a single transaction.
 * Compresses PNG bitmaps to JPEG 0.75 before writing to save storage space.
 */
export const saveBitmapsBatch = async (entries: { id: string; bitmap: string; libraryId: string }[]): Promise<void> => {
  if (entries.length === 0) return;
  const compressed = await Promise.all(
    entries.map(async ({ id, bitmap, libraryId }) => ({
      id,
      bitmap: await compressForStorage(bitmap),
      libraryId,
    }))
  );
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_BITMAPS], 'readwrite');
    const store = transaction.objectStore(STORE_BITMAPS);
    const now = Date.now();
    compressed.forEach(({ id, bitmap, libraryId }) => {
      store.put({ id, bitmap, timestamp: now, libraryId } as BitmapEntry);
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const saveBitmap = async (id: string, bitmap: string, libraryId: string): Promise<void> => {
  const compressed = await compressForStorage(bitmap);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_BITMAPS], 'readwrite');
    const store = transaction.objectStore(STORE_BITMAPS);
    const request = store.put({ id, bitmap: compressed, timestamp: Date.now(), libraryId } as BitmapEntry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getBitmap = async (id: string, libraryId: string): Promise<string | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_BITMAPS], 'readonly');
    const store = transaction.objectStore(STORE_BITMAPS);
    const request = store.get([libraryId, id]);
    request.onsuccess = () => {
      const result = request.result as BitmapEntry | undefined;
      resolve(result?.bitmap || null);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getAllBitmaps = async (): Promise<Map<string, string>> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_BITMAPS], 'readonly');
    const store = transaction.objectStore(STORE_BITMAPS);
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = request.result as BitmapEntry[];
      const map = new Map<string, string>();
      entries.forEach(e => map.set(e.id, e.bitmap));
      resolve(map);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getAllBitmapsForLibrary = async (libraryId: string): Promise<Map<string, string>> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_BITMAPS], 'readonly');
    const store = transaction.objectStore(STORE_BITMAPS);
    const index = store.index('libraryId');
    const request = index.getAll(libraryId);
    request.onsuccess = () => {
      const entries = request.result as BitmapEntry[];
      const map = new Map<string, string>();
      entries.forEach(e => map.set(e.id, e.bitmap));
      resolve(map);
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteBitmap = async (id: string, libraryId: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_BITMAPS], 'readwrite');
    const store = transaction.objectStore(STORE_BITMAPS);
    const request = store.delete([libraryId, id]);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const deleteBitmapsForLibrary = async (libraryId: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_BITMAPS], 'readwrite');
    const store = transaction.objectStore(STORE_BITMAPS);
    const index = store.index('libraryId');
    const request = index.openCursor(libraryId);
    request.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

// ─── SVGs ────────────────────────────────────────────────────────────────────

/**
 * Write SVG fields for a row. Both fields are written as passed — an
 * `undefined` value CLEARS the field on disk, it does not merge with the
 * existing entry. Callers that want to update just one field must read
 * the other one and pass it explicitly.
 *
 * (Previously this function merged undefined fields with the existing
 * entry, which made it impossible to delete an SVG once persisted: a
 * subsequent save with the field set to undefined silently resurrected
 * the old value. The only caller in the codebase passes both fields, so
 * removing the merge is safe.)
 */
export const saveSvgs = async (id: string, svgs: { rawSvg?: string; structuredSvg?: string }, libraryId?: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SVGS], 'readwrite');
    const store = transaction.objectStore(STORE_SVGS);
    const entry: SvgEntry = {
      id,
      timestamp: Date.now(),
      rawSvg: svgs.rawSvg,
      structuredSvg: svgs.structuredSvg,
      libraryId,
    };
    const putReq = store.put(entry);
    putReq.onsuccess = () => resolve();
    putReq.onerror = () => reject(putReq.error);
  });
};

export const getSvgs = async (id: string): Promise<{ rawSvg?: string; structuredSvg?: string } | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SVGS], 'readonly');
    const store = transaction.objectStore(STORE_SVGS);
    const request = store.get(id);
    request.onsuccess = () => {
      const result = request.result as SvgEntry | undefined;
      if (!result) { resolve(null); return; }
      resolve({ rawSvg: result.rawSvg, structuredSvg: result.structuredSvg });
    };
    request.onerror = () => reject(request.error);
  });
};

export const getAllSvgs = async (): Promise<Map<string, { rawSvg?: string; structuredSvg?: string }>> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SVGS], 'readonly');
    const store = transaction.objectStore(STORE_SVGS);
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = request.result as SvgEntry[];
      const map = new Map<string, { rawSvg?: string; structuredSvg?: string }>();
      entries.forEach(e => map.set(e.id, { rawSvg: e.rawSvg, structuredSvg: e.structuredSvg }));
      resolve(map);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getAllSvgsForLibrary = async (libraryId: string): Promise<Map<string, { rawSvg?: string; structuredSvg?: string }>> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SVGS], 'readonly');
    const store = transaction.objectStore(STORE_SVGS);
    const index = store.index('libraryId');
    const request = index.getAll(libraryId);
    request.onsuccess = () => {
      const entries = request.result as SvgEntry[];
      const map = new Map<string, { rawSvg?: string; structuredSvg?: string }>();
      entries.forEach(e => map.set(e.id, { rawSvg: e.rawSvg, structuredSvg: e.structuredSvg }));
      resolve(map);
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteSvgs = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SVGS], 'readwrite');
    const store = transaction.objectStore(STORE_SVGS);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const deleteSvgsForLibrary = async (libraryId: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SVGS], 'readwrite');
    const store = transaction.objectStore(STORE_SVGS);
    const index = store.index('libraryId');
    const request = index.openCursor(libraryId);
    request.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

// ─── Clear all ───────────────────────────────────────────────────────────────

/**
 * Clear all data from all stores (used by "delete all" action).
 */
export const clearAllData = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_ROWS, STORE_BITMAPS, STORE_SVGS], 'readwrite');
    transaction.objectStore(STORE_ROWS).clear();
    transaction.objectStore(STORE_BITMAPS).clear();
    transaction.objectStore(STORE_SVGS).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/** @deprecated use clearAllData() */
export const clearAllBitmaps = clearAllData;

// ─── Storage estimate ────────────────────────────────────────────────────────

export const getStorageEstimate = async (): Promise<{ usage: number; quota: number } | null> => {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
  }
  return null;
};
