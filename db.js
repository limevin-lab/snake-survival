// Persistent leaderboard backed by libSQL / Turso (SQLite-compatible, cloud-hosted).
// In production set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) to a Turso database;
// with no env vars it falls back to a local SQLite file so you can develop offline.
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:leaderboard.db',
  authToken: process.env.TURSO_AUTH_TOKEN, // unused for local file: URLs
});

// Create the table once at startup (top-level await — this file is an ES module).
await db.execute(`
  CREATE TABLE IF NOT EXISTS scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname   TEXT    NOT NULL,
    score      INTEGER NOT NULL,
    food       INTEGER NOT NULL DEFAULT 0,
    seconds    INTEGER NOT NULL DEFAULT 0,
    level      INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
`);

export async function recordScore({ nickname, score, food, seconds, level }) {
  await db.execute({
    sql: `INSERT INTO scores (nickname, score, food, seconds, level, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      String(nickname).slice(0, 16),
      Math.max(0, Math.round(score)),
      Math.max(0, Math.round(food)),
      Math.max(0, Math.round(seconds)),
      Math.max(1, Math.round(level)),
      Date.now(),
    ],
  });
}

// Top N scores, one row per nickname (a player's best run only), highest first.
export async function getTopScores(limit = 10) {
  const result = await db.execute({
    sql: `SELECT nickname, MAX(score) AS score, food, seconds, level
          FROM scores
          GROUP BY nickname
          ORDER BY score DESC
          LIMIT ?`,
    args: [limit],
  });
  // Return plain objects so they serialize cleanly over socket.io.
  return result.rows.map((r) => ({
    nickname: r.nickname,
    score: r.score,
    food: r.food,
    seconds: r.seconds,
    level: r.level,
  }));
}
