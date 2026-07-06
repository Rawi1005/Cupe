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
to a serverless endpoint (`api/kv.js`) backed by any standard **Redis** database.

1. Add a `REDIS_URL` environment variable to the Vercel project (**Settings → Environment
   Variables**) with your Redis connection string:

   ```
   redis://default:<password>@<host>:<port>
   rediss://default:<password>@<host>:<port>   # use rediss:// for TLS
   ```

   Your Redis must be reachable from Vercel's servers (i.e. a publicly accessible / managed Redis,
   not one bound to localhost or a private network).
2. Redeploy. That's it — no code changes needed.

Already using Vercel KV / Upstash? It exposes the same kind of connection string as `KV_URL`, and
the endpoint reads that too — so `REDIS_URL` **or** `KV_URL` works.

If neither is set, the endpoint returns `501` and the app **automatically falls back to
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
