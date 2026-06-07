# 🐍 Snake Survival

A live, two-player online survival Snake game. Players just type a nickname and play.
If nobody else is around, you face an AI. Survive as long as you can — the game speeds
up and spawns obstacles every 30 seconds, and crossing **2:00** triggers hard mode.
Every run is saved to a **permanent leaderboard** that everyone sees.

## Features

- **Two players at once** — both snakes share one arena; last one alive wins.
- **AI fallback** — alone for 5 seconds? An AI opponent drops in automatically.
- **Difficulty ramp** — speed increases and obstacles appear every 30s; hard mode at 2:00.
- **Permanent leaderboard** — stored in SQLite, survives restarts, shown to all players.
- **Nickname only** — no accounts, no passwords.
- **Server-authoritative** — the game loop runs on the server, so scores can't be faked.
- Works on desktop (Arrow keys / WASD) and mobile (swipe).

## Run it locally

```bash
cd snake-survival
npm install
npm start
```

Then open **http://localhost:3000**. To try multiplayer, open a second browser
tab/window and join with a different nickname within 5 seconds — you'll be matched together.

> Using a different port: `PORT=4000 npm start`

## How it works

| Piece | File | Role |
|-------|------|------|
| Web server + matchmaking | `server.js` | Pairs players into rooms; adds AI after 5s; persists scores |
| Game engine | `room.js` | Authoritative loop, collisions, food, difficulty ramp, AI |
| Leaderboard storage | `db.js` | SQLite (`leaderboard.db`), top scores per nickname |
| Frontend | `public/` | Canvas rendering, controls, leaderboard UI |

### Tunable settings
- AI wait time: `AI_WAIT_MS` in `server.js` (default 5000 ms).
- Speed / ramp / hard-mode timing: constants at the top of `room.js`
  (`BASE_TICK_MS`, `MIN_TICK_MS`, `RAMP_SECONDS`, `HARD_MODE_SECONDS`).
- Arena size: `COLS` / `ROWS` in `room.js`.

## Deploy it live (so anyone with the link can play)

The app is a single Node process and listens on `process.env.PORT`. The only thing
that needs to persist is the SQLite file (`leaderboard.db`); set `DB_PATH` to point
at a mounted disk on hosts that provide one.

### Option A — Render (free tier)
1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com): **New → Web Service**, connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. (Recommended) Add a **Disk** (e.g. mount path `/data`) and set an env var
   `DB_PATH=/data/leaderboard.db` so the leaderboard survives deploys.
5. Deploy — Render gives you a public `https://...onrender.com` link to share.

### Option B — Railway
1. `railway init` in this folder (or connect the GitHub repo on railway.app).
2. Railway auto-detects Node and runs `npm start`.
3. Add a **Volume**, mount it (e.g. `/data`), and set `DB_PATH=/data/leaderboard.db`.
4. Generate a public domain in the service settings and share the link.

### Option C — Fly.io
1. Install the CLI and run `fly launch` (it detects Node, sets `PORT`).
2. Create a volume: `fly volumes create data --size 1`.
3. In `fly.toml` mount it to `/data` and set `DB_PATH=/data/leaderboard.db`.
4. `fly deploy` → share the `https://<app>.fly.dev` link.

> ⚠️ On hosts **without** a persistent disk, the leaderboard resets on each
> redeploy/restart. Attaching a volume + `DB_PATH` (steps above) keeps it permanent.

## Gameplay

- **Move:** Arrow keys or WASD (desktop), swipe (mobile).
- **Eat** the orange food to grow and score; food is worth more at higher levels.
- **Avoid** walls, obstacles, your own tail, and the other snake.
- **Score** = food value + seconds survived. Your best run per nickname is ranked.
