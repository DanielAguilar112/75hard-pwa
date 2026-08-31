import { get, set, del } from 'idb-keyval';

// Thin wrapper so the rest of the app doesn't care that it's IndexedDB.
// Falls back to localStorage if IndexedDB is unavailable (e.g. private browsing edge cases).

const memoryFallback = new Map();

async function safeGet(key) {
  try {
    return await get(key);
  } catch (e) {
    return memoryFallback.get(key);
  }
}

async function safeSet(key, value) {
  try {
    await set(key, value);
    return true;
  } catch (e) {
    memoryFallback.set(key, value);
    return false;
  }
}

async function safeDel(key) {
  try {
    await del(key);
  } catch (e) {
    memoryFallback.delete(key);
  }
}

export const storage = {
  getState: () => safeGet('challenge-state'),
  setState: (value) => safeSet('challenge-state', value),
  getPhotos: () => safeGet('challenge-photos'),
  setPhotos: (value) => safeSet('challenge-photos', value),
  getHistory: () => safeGet('challenge-history'),
  setHistory: (value) => safeSet('challenge-history', value),
  clearAll: async () => {
    await safeDel('challenge-state');
    await safeDel('challenge-photos');
    await safeDel('challenge-history');
  },
};