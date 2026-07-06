/* ---------------------------------------------------------------
   /api/kv — shared key/value store for cross-device multiplayer

   Backed by Vercel KV / Upstash Redis over its REST API. The
   Marketplace integration exposes KV_REST_API_URL and
   KV_REST_API_TOKEN; we talk to it with plain fetch so there's no
   SDK dependency to keep in sync.

   GET  /api/kv?key=<key>      -> { value: <string|null> }
   POST /api/kv { key, value } -> { ok: true }

   When the env vars are missing the endpoint returns 501 so the
   client can fall back to localStorage.
--------------------------------------------------------------- */
const REST_URL = process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN;

// Rooms are ephemeral — expire them a day after the last write so the
// store doesn't fill up with abandoned games.
const TTL_SECONDS = 60 * 60 * 24;

async function redis(command) {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.result;
}

export default async function handler(req, res) {
  if (!REST_URL || !REST_TOKEN) {
    return res.status(501).json({ error: "KV not configured" });
  }

  try {
    if (req.method === "GET") {
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: "missing key" });
      const value = await redis(["GET", key]);
      return res.status(200).json({ value: value ?? null });
    }

    if (req.method === "POST") {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: "missing key" });
      await redis(["SET", key, String(value), "EX", TTL_SECONDS]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
