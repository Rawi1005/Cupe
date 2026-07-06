/* ---------------------------------------------------------------
   window.storage shim

   The original game targeted the Claude artifacts runtime, which
   exposes a global `window.storage` key/value API where the trailing
   boolean marks a value as *shared* (visible to every player) vs.
   *local* (private to this device). We reproduce that here:

     - shared values (room state)  -> /api/kv  (Vercel KV / Upstash),
       so players on different devices see the same room. Falls back
       to localStorage if the KV backend isn't configured/reachable.
     - local values (this device's player id) -> localStorage.

   With KV configured, cross-device multiplayer works. Without it, the
   game still runs but rooms are only visible within one browser.
--------------------------------------------------------------- */
const memory = new Map();
const API = "/api/kv";

// Set to true once the API tells us KV isn't configured (HTTP 501),
// so we stop hammering it and go straight to localStorage.
let kvUnavailable = false;

function hasLocalStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function localGet(key) {
  if (hasLocalStorage()) {
    const value = window.localStorage.getItem(key);
    return value === null ? null : { value };
  }
  return memory.has(key) ? { value: memory.get(key) } : null;
}

function localSet(key, value) {
  if (hasLocalStorage()) window.localStorage.setItem(key, value);
  else memory.set(key, value);
  return true;
}

async function kvGet(key) {
  const res = await fetch(`${API}?key=${encodeURIComponent(key)}`);
  if (res.status === 501) {
    kvUnavailable = true;
    return null; // signal caller to use the local fallback
  }
  if (!res.ok) throw new Error(`kv get ${res.status}`);
  const data = await res.json();
  return { value: data.value ?? null };
}

async function kvSet(key, value) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (res.status === 501) {
    kvUnavailable = true;
    return false; // signal caller to use the local fallback
  }
  if (!res.ok) throw new Error(`kv set ${res.status}`);
  return true;
}

const storage = {
  // get(key, shared?) -> { value } | null
  async get(key, shared) {
    if (shared && !kvUnavailable) {
      try {
        const result = await kvGet(key);
        if (result !== null || !kvUnavailable) return result;
      } catch (e) {
        console.warn("KV get failed, using localStorage:", e);
      }
    }
    return localGet(key);
  },

  // set(key, value, shared?) -> boolean
  async set(key, value, shared) {
    const str = String(value);
    if (shared && !kvUnavailable) {
      try {
        const ok = await kvSet(key, str);
        if (ok) return true;
        // fall through to localStorage when KV is unavailable
      } catch (e) {
        console.warn("KV set failed, using localStorage:", e);
      }
    }
    return localSet(key, str);
  },

  async delete(key) {
    if (hasLocalStorage()) window.localStorage.removeItem(key);
    else memory.delete(key);
    return true;
  },
};

if (typeof window !== "undefined" && !window.storage) {
  window.storage = storage;
}

export default storage;
