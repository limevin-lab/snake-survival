// Persistent leaderboard backed by SQLite.
// The database file (leaderboard.db) lives next to this file and survives restarts.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Allow overriding the DB location (useful on hosts with a mounted persistent disk).
const dbPath = process.env.DB_PATH || join(__dirname, 'leaderboard.db');
// Ensure the target directory exists (e.g. a DB_PATH like /data/leaderboard.db
// before the mounted disk has been provisioned) so we don't crash on startup.
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS scores (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname  TEXT    NOT NULL,
    score     INTEGER NOT NULL,
    food      INTEGER NOT NULL DEFAULT 0,
    seconds   INTEGER NOT NULL DEFAULT 0,
    level     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
`);

const insertStmt = db.prepare(
  `INSERT INTO scores (nickname, score, food, seconds, level, created_at)
   VALUES (@nickname, @score, @food, @seconds, @level, @created_at)`
);

// Top N scores, one row per nickname (a player's best run only), highest first.
const topStmt = db.prepare(`
  SELECT nickname, MAX(score) AS score, food, seconds, level
  FROM scores
  GROUP BY nickname
  ORDER BY score DESC
  LIMIT ?
`);

export function recordScore({ nickname, score, food, seconds, level }) {
  insertStmt.run({
    nickname: String(nickname).slice(0, 16),
    score: Math.max(0, Math.round(score)),
    food: Math.max(0, Math.round(food)),
    seconds: Math.max(0, Math.round(seconds)),
    level: Math.max(1, Math.round(level)),
    created_at: Date.now(),
  });
}

export function getTopScores(limit = 10) {
  return topStmt.all(limit);
}
