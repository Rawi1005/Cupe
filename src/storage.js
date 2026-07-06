/* ---------------------------------------------------------------
   window.storage shim

   The original game targeted the Claude artifacts runtime, which
   exposes a global `window.storage` key/value API. That global does
   not exist on Vercel (or any normal web host), so we provide a
   drop-in replacement backed by localStorage.

   localStorage is shared across tabs/windows of the same browser on
   the same origin, so the polling-based multiplayer keeps working
   between tabs on one machine. It is NOT shared across devices — for
   true cross-device play you'd need a shared server-side store.
--------------------------------------------------------------- */
const memory = new Map();

function hasLocalStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

const storage = {
  // Mirrors the artifacts API: resolves to { value } or null.
  async get(key) {
    if (hasLocalStorage()) {
      const value = window.localStorage.getItem(key);
      return value === null ? null : { value };
    }
    return memory.has(key) ? { value: memory.get(key) } : null;
  },
  async set(key, value) {
    const str = String(value);
    if (hasLocalStorage()) {
      window.localStorage.setItem(key, str);
    } else {
      memory.set(key, str);
    }
    return true;
  },
  async delete(key) {
    if (hasLocalStorage()) {
      window.localStorage.removeItem(key);
    } else {
      memory.delete(key);
    }
    return true;
  },
};

if (typeof window !== "undefined" && !window.storage) {
  window.storage = storage;
}

export default storage;
