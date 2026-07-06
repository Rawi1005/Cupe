# COUP

A browser version of the bluffing card game **Coup** — bluff, block, and betray your way to the throne.

Built with [Vite](https://vite.dev/) + React + [Tailwind CSS](https://tailwindcss.com/), and ready to deploy on Vercel.

## Local development

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # production build into ./dist
npm run preview  # serve the production build locally
```

## Deploying to Vercel

The repo ships a `vercel.json` and is a standard Vite app.

- **Dashboard:** import the repository at [vercel.com/new](https://vercel.com/new). Vercel auto-detects the Vite framework preset:
  - Build command: `npm run build`
  - Output directory: `dist`
- **CLI:**
  ```bash
  npm i -g vercel
  vercel        # preview deploy
  vercel --prod # production deploy
  ```

### Enable cross-device multiplayer (Redis)

For friends on **other devices** to join a room, the deployment needs a shared store. The app talks
to a serverless endpoint (`api/kv.js`) that auto-detects **either** kind of Redis credentials — no
code changes needed, just set env vars in **Settings → Environment Variables** and redeploy.

**Option 1 — Upstash / Vercel KV (HTTP REST).** If you added the Upstash Redis or Vercel KV
integration, these are set for you automatically:

```
UPSTASH_REDIS_REST_URL   (or KV_REST_API_URL)
UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN)
```

**Option 2 — a plain Redis connection string.** Point it at any managed Redis over the Redis
protocol:

```
REDIS_URL=redis://default:<password>@<host>:<port>
REDIS_URL=rediss://default:<password>@<host>:<port>   # rediss:// for TLS
```

Your Redis must be reachable from Vercel's servers (a publicly accessible / managed Redis, not one
bound to localhost or a private network).

If **neither** is set, the endpoint returns `501` and the app **automatically falls back to
`localStorage`**, so it still runs — but rooms are then only visible within a single browser.

## Multiplayer & storage

The game shares room state through a `window.storage` key/value API. The original ran inside the
Claude artifacts runtime, which provided that global; here it's replaced by a shim
(`src/storage.js`) installed before the app renders:

- **Shared** values (room state) go through `/api/kv` → Redis, so every player sees the same room
  across devices. Rooms auto-expire 24h after their last update.
- **Local** values (this device's player id) stay in `localStorage`.
- If Redis isn't configured or is unreachable, shared values transparently fall back to
  `localStorage`.

## How to play

1. Enter your name and **Create a room**, then share the 4-letter room code.
2. Others enter their name and the code to **Join**.
3. The host starts the game once at least two players are seated.
4. Take actions, challenge claims, block, and be the last influence standing.

A role reference is available at the bottom of the game screen.
