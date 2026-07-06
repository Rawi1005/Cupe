/* ---------------------------------------------------------------
   /api/kv — shared key/value store for cross-device multiplayer

   Works with either kind of Redis credentials, auto-detected from the
   environment:

   1. Upstash HTTP REST (great for serverless) — set by the Upstash /
      Vercel KV integration:
        UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
        (also accepts KV_REST_API_URL + KV_REST_API_TOKEN)

   2. A plain Redis connection string over the Redis protocol:
        REDIS_URL (or KV_URL), e.g. redis://... or rediss://...

   GET  /api/kv?key=<key>      -> { value: <string|null> }
   POST /api/kv { key, value } -> { ok: true }

   With no credentials configured the endpoint returns 501 so the client
   can fall back to localStorage.
--------------------------------------------------------------- */
const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL;

// Rooms are ephemeral — expire them a day after the last write so the
// store doesn't fill up with abandoned games.
const TTL_SECONDS = 60 * 60 * 24;

function configured() {
  return Boolean((REST_URL && REST_TOKEN) || REDIS_URL);
}

/* --- Backend 1: Upstash HTTP REST --------------------------------- */
async function restCommand(command) {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.result;
}

/* --- Backend 2: Redis protocol via ioredis ------------------------ */
// Reuse one connection across warm invocations. Loaded lazily so the
// REST path doesn't pay for it. Cached on globalThis to survive reloads.
async function tcpClient() {
  if (!globalThis.__coupRedis) {
    const { default: Redis } = await import("ioredis");
    globalThis.__coupRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
    globalThis.__coupRedis.on("error", (e) =>
      console.error("Redis connection error:", e?.message || e)
    );
  }
  return globalThis.__coupRedis;
}

async function kvGet(key) {
  if (REST_URL && REST_TOKEN) return (await restCommand(["GET", key])) ?? null;
  const client = await tcpClient();
  return (await client.get(key)) ?? null;
}

async function kvSet(key, value) {
  if (REST_URL && REST_TOKEN) {
    await restCommand(["SET", key, value, "EX", TTL_SECONDS]);
    return;
  }
  const client = await tcpClient();
  await client.set(key, value, "EX", TTL_SECONDS);
}

export default async function handler(req, res) {
  if (!configured()) {
    return res.status(501).json({ error: "storage not configured" });
  }

  try {
    if (req.method === "GET") {
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: "missing key" });
      const value = await kvGet(key);
      return res.status(200).json({ value: value ?? null });
    }

    if (req.method === "POST") {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: "missing key" });
      await kvSet(key, String(value));
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
