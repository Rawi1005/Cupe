/* ---------------------------------------------------------------
   /api/kv — shared key/value store for cross-device multiplayer

   Backed by a standard Redis database over the Redis protocol. Set a
   connection string in the REDIS_URL environment variable, e.g.

       redis://default:password@host:6379
       rediss://default:password@host:6379   (TLS)

   Vercel KV / Upstash also expose such a string as KV_URL, so either
   env var works.

   GET  /api/kv?key=<key>      -> { value: <string|null> }
   POST /api/kv { key, value } -> { ok: true }

   When no connection string is configured the endpoint returns 501 so
   the client can fall back to localStorage.
--------------------------------------------------------------- */
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL;

// Rooms are ephemeral — expire them a day after the last write so the
// store doesn't fill up with abandoned games.
const TTL_SECONDS = 60 * 60 * 24;

// Reuse one connection across warm invocations instead of dialing on
// every request. Cached on globalThis so it survives module reloads.
function getClient() {
  if (!REDIS_URL) return null;
  if (!globalThis.__coupRedis) {
    globalThis.__coupRedis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      // Upstash and most managed Redis over `rediss://` need TLS; ioredis
      // picks that up from the URL scheme automatically.
    });
    globalThis.__coupRedis.on("error", (e) => {
      console.error("Redis connection error:", e?.message || e);
    });
  }
  return globalThis.__coupRedis;
}

export default async function handler(req, res) {
  const client = getClient();
  if (!client) {
    return res.status(501).json({ error: "Redis not configured" });
  }

  try {
    if (req.method === "GET") {
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: "missing key" });
      const value = await client.get(key);
      return res.status(200).json({ value: value ?? null });
    }

    if (req.method === "POST") {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: "missing key" });
      await client.set(key, String(value), "EX", TTL_SECONDS);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
