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

The repo ships a `vercel.json` and is a standard Vite app, so no configuration is needed.

- **Dashboard:** import the repository at [vercel.com/new](https://vercel.com/new). Vercel auto-detects the Vite framework preset:
  - Build command: `npm run build`
  - Output directory: `dist`
- **CLI:**
  ```bash
  npm i -g vercel
  vercel        # preview deploy
  vercel --prod # production deploy
  ```

## Multiplayer & storage

The game shares room state through a `window.storage` key/value API. The original ran inside the
Claude artifacts runtime, which provided that global; here it's replaced by a localStorage-backed
shim (`src/storage.js`) that is installed before the app renders.

Because it uses `localStorage`, room state is shared **across tabs/windows of the same browser on
the same device** — good for local hot-seat / same-machine play. It is **not** shared across
different devices or browsers. For true cross-device multiplayer you'd swap `src/storage.js` for a
shared server-side store (e.g. Vercel KV / Upstash Redis) behind a small serverless API.

## How to play

1. Enter your name and **Create a room**, then share the 4-letter room code.
2. Others enter their name and the code to **Join**.
3. The host starts the game once at least two players are seated.
4. Take actions, challenge claims, block, and be the last influence standing.

A role reference is available at the bottom of the game screen.
