// Server-authoritative Snake game room.
// Each room holds up to two players (human or AI), runs its own game loop,
// ramps difficulty over time, and reports final scores when the round ends.

export const COLS = 28;
export const ROWS = 28;

const BASE_TICK_MS = 170;     // starting speed (lower = faster)
const MIN_TICK_MS = 70;       // fastest the game ever gets
const RAMP_SECONDS = 30;      // difficulty increases every 30s
const TICK_STEP_MS = 20;      // how much faster each level is
const HARD_MODE_SECONDS = 120; // "still alive after 2 minutes" threshold
const END_COUNTDOWN_MS = 3000; // once a snake dies, end the round after this delay

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

let roomCounter = 0;

export class Room {
  constructor({ onState, onGameOver }) {
    this.id = `room-${++roomCounter}`;
    this.onState = onState;       // (roomId, state) => void
    this.onGameOver = onGameOver; // (roomId, results) => void
    this.players = {};            // slot -> player object
    this.food = null;
    this.obstacles = [];
    this.timer = null;
    this.startedAt = 0;
    this.running = false;
    this.level = 1;
    this.tickMs = BASE_TICK_MS;
    this.endsAt = null;           // ms timestamp when the round should end (set after a death)
  }

  get playerCount() {
    return Object.values(this.players).filter((p) => !p.isAI).length;
  }

  hasOpenHumanSlot() {
    // Room waiting for a second human (only one human, AI not yet added, not started).
    return !this.running && this.playerCount === 1 && Object.keys(this.players).length === 1;
  }

  addPlayer({ socketId, nickname, isAI = false }) {
    const slot = this.players[0] ? 1 : 0;
    const spawn = this._spawnFor(slot);
    this.players[slot] = {
      slot,
      socketId,
      nickname: isAI ? 'CPU' : nickname,
      isAI,
      body: spawn.body,
      dir: spawn.dir,
      nextDir: spawn.dir,
      alive: true,
      food: 0,
      score: 0,
      diedAtSeconds: 0,
      color: slot === 0 ? '#4ade80' : '#60a5fa',
    };
    return slot;
  }

  _spawnFor(slot) {
    const midY = Math.floor(ROWS / 2);
    if (slot === 0) {
      const x = 4;
      return {
        dir: 'right',
        body: [ { x, y: midY }, { x: x - 1, y: midY }, { x: x - 2, y: midY } ],
      };
    }
    const x = COLS - 5;
    return {
      dir: 'left',
      body: [ { x, y: midY }, { x: x + 1, y: midY }, { x: x + 2, y: midY } ],
    };
  }

  setDirection(socketId, dir) {
    if (!DIRS[dir]) return;
    const player = Object.values(this.players).find((p) => p.socketId === socketId);
    if (!player || !player.alive) return;
    // Disallow reversing directly into yourself.
    if (dir === OPPOSITE[player.dir]) return;
    player.nextDir = dir;
  }

  // A human left: keep the round playable by handing their snake to the AI.
  handleDisconnect(socketId) {
    const player = Object.values(this.players).find((p) => p.socketId === socketId);
    if (!player) return;
    player.isAI = true;
    player.socketId = null;
    player.disconnected = true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this._spawnFood();
    this._scheduleTick();
  }

  _scheduleTick() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._tick(), this.tickMs);
  }

  _elapsedSeconds() {
    return (Date.now() - this.startedAt) / 1000;
  }

  _updateDifficulty() {
    const elapsed = this._elapsedSeconds();
    const newLevel = Math.floor(elapsed / RAMP_SECONDS) + 1;
    if (newLevel !== this.level) {
      this.level = newLevel;
      this.tickMs = Math.max(MIN_TICK_MS, BASE_TICK_MS - (newLevel - 1) * TICK_STEP_MS);
      this._growObstacles();
    }
  }

  _tick() {
    if (!this.running) return;
    this._updateDifficulty();

    // Decide AI moves before resolving movement.
    for (const p of Object.values(this.players)) {
      if (p.isAI && p.alive) p.nextDir = this._aiChooseDir(p);
    }

    // Apply queued directions, then compute new heads.
    const moves = {};
    for (const p of Object.values(this.players)) {
      if (!p.alive) continue;
      p.dir = p.nextDir;
      const d = DIRS[p.dir];
      moves[p.slot] = { x: p.body[0].x + d.x, y: p.body[0].y + d.y };
    }

    // Build the set of currently-occupied body cells (before moving).
    const occupied = new Map(); // "x,y" -> slot
    for (const p of Object.values(this.players)) {
      if (!p.alive) continue;
      p.body.forEach((seg, i) => {
        // The tail will move away unless that snake eats this tick; treat all
        // current segments as solid for simplicity (slightly forgiving is fine).
        occupied.set(`${seg.x},${seg.y}`, p.slot);
      });
    }

    const ate = {};
    const willDie = {};

    for (const p of Object.values(this.players)) {
      if (!p.alive) continue;
      const head = moves[p.slot];

      // Wall collision.
      if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) {
        willDie[p.slot] = true;
        continue;
      }
      // Obstacle collision.
      if (this.obstacles.some((o) => o.x === head.x && o.y === head.y)) {
        willDie[p.slot] = true;
        continue;
      }
      // Eats food?
      ate[p.slot] = this.food && head.x === this.food.x && head.y === this.food.y;
    }

    // Head-to-head and body collisions (resolve after computing all heads).
    for (const p of Object.values(this.players)) {
      if (!p.alive || willDie[p.slot]) continue;
      const head = moves[p.slot];
      const key = `${head.x},${head.y}`;

      // Hit any current body segment (own or opponent).
      if (occupied.has(key)) {
        // Allow moving into a tail cell that is vacating (snake not eating).
        const otherSlot = occupied.get(key);
        const other = this.players[otherSlot];
        const isTail = other && other.body.length &&
          other.body[other.body.length - 1].x === head.x &&
          other.body[other.body.length - 1].y === head.y &&
          !ate[otherSlot];
        if (!isTail) willDie[p.slot] = true;
      }

      // Two heads landing on the same cell -> both die.
      for (const q of Object.values(this.players)) {
        if (q.slot === p.slot || !q.alive || willDie[q.slot]) continue;
        const qHead = moves[q.slot];
        if (qHead.x === head.x && qHead.y === head.y) {
          willDie[p.slot] = true;
          willDie[q.slot] = true;
        }
      }
    }

    // Apply movement / deaths.
    let foodEaten = false;
    for (const p of Object.values(this.players)) {
      if (!p.alive) continue;
      if (willDie[p.slot]) {
        p.alive = false;
        p.diedAtSeconds = this._elapsedSeconds();
        continue;
      }
      const head = moves[p.slot];
      p.body.unshift(head);
      if (ate[p.slot]) {
        p.food += 1;
        p.score += 10 * this.level; // food is worth more as it gets harder
        foodEaten = true;
      } else {
        p.body.pop();
      }
    }

    if (foodEaten) this._spawnFood();

    // Award a small survival bonus over time to living snakes.
    for (const p of Object.values(this.players)) {
      if (p.alive) p.score = p.food * 10 * this.level + Math.floor(this._elapsedSeconds());
    }

    this.onState(this.id, this.serialize());

    // Once any snake dies, run a short countdown (so the player sees what
    // happened) and then end the round, even if a rival is still alive.
    const anyDead = Object.values(this.players).some((p) => !p.alive);
    if (anyDead && this.endsAt === null) {
      this.endsAt = Date.now() + END_COUNTDOWN_MS;
    }
    if (this.endsAt !== null && Date.now() >= this.endsAt) {
      this._endGame();
      return;
    }
    this._scheduleTick();
  }

  // Whole seconds left on the end-of-round countdown, or null if not counting down.
  _endsInSeconds() {
    if (this.endsAt === null) return null;
    return Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
  }

  _endGame() {
    this.running = false;
    clearTimeout(this.timer);
    const results = Object.values(this.players).map((p) => ({
      slot: p.slot,
      nickname: p.nickname,
      isAI: p.isAI,
      disconnected: !!p.disconnected,
      socketId: p.socketId,
      score: Math.round(p.score),
      food: p.food,
      seconds: Math.round(p.diedAtSeconds || this._elapsedSeconds()),
      level: this.level,
    }));
    results.sort((a, b) => b.score - a.score);
    this.onGameOver(this.id, results);
  }

  // ---- World generation -------------------------------------------------

  _randomEmptyCell() {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = Math.floor(Math.random() * COLS);
      const y = Math.floor(Math.random() * ROWS);
      if (this._isCellFree(x, y)) return { x, y };
    }
    return { x: 0, y: 0 };
  }

  _isCellFree(x, y) {
    if (this.obstacles.some((o) => o.x === x && o.y === y)) return false;
    if (this.food && this.food.x === x && this.food.y === y) return false;
    for (const p of Object.values(this.players)) {
      if (p.body.some((s) => s.x === x && s.y === y)) return false;
    }
    return true;
  }

  _spawnFood() {
    this.food = this._randomEmptyCell();
  }

  _growObstacles() {
    // Add a few obstacles each level, keeping clear of the spawn rows.
    const target = (this.level - 1) * 3;
    const midY = Math.floor(ROWS / 2);
    while (this.obstacles.length < target) {
      const cell = this._randomEmptyCell();
      // Don't drop obstacles right on the central lanes where snakes start.
      if (Math.abs(cell.y - midY) <= 1) continue;
      this.obstacles.push(cell);
    }
  }

  // ---- AI ---------------------------------------------------------------

  _aiChooseDir(p) {
    const head = p.body[0];
    const options = Object.keys(DIRS).filter((d) => d !== OPPOSITE[p.dir]);
    const safe = [];
    for (const d of options) {
      const nx = head.x + DIRS[d].x;
      const ny = head.y + DIRS[d].y;
      if (!this._aiCellSafe(nx, ny, p)) continue;
      // Prefer moves with more open space ahead (cheap flood-fill look-ahead).
      const room = this._aiFreedom(nx, ny, p);
      const dist = this.food ? Math.abs(nx - this.food.x) + Math.abs(ny - this.food.y) : 0;
      safe.push({ d, room, dist });
    }
    if (safe.length === 0) return p.dir; // doomed; keep going
    // Avoid getting boxed in: require some breathing room, then chase food.
    safe.sort((a, b) => (b.room - a.room) || (a.dist - b.dist));
    // If the roomiest options are comparable, pick the one closest to food.
    const best = safe[0];
    const contenders = safe.filter((s) => s.room >= best.room - 3);
    contenders.sort((a, b) => a.dist - b.dist);
    return contenders[0].d;
  }

  _aiCellSafe(x, y, p) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
    if (this.obstacles.some((o) => o.x === x && o.y === y)) return false;
    for (const q of Object.values(this.players)) {
      if (!q.alive) continue;
      // Ignore the very tail (it will move) unless it's about to grow — keep simple.
      const segs = q.slot === p.slot ? q.body.slice(0, -1) : q.body;
      if (segs.some((s) => s.x === x && s.y === y)) return false;
    }
    return true;
  }

  // Flood fill from a cell to estimate reachable free space (capped for speed).
  _aiFreedom(x, y, p) {
    const seen = new Set([`${x},${y}`]);
    const queue = [{ x, y }];
    let count = 0;
    const cap = 40;
    while (queue.length && count < cap) {
      const cur = queue.shift();
      count++;
      for (const d of Object.values(DIRS)) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        if (!this._aiCellSafe(nx, ny, p)) continue;
        seen.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    return count;
  }

  // ---- Serialization ----------------------------------------------------

  serialize() {
    return {
      cols: COLS,
      rows: ROWS,
      level: this.level,
      elapsed: Math.floor(this._elapsedSeconds()),
      hardMode: this._elapsedSeconds() >= HARD_MODE_SECONDS,
      endsIn: this._endsInSeconds(),
      food: this.food,
      obstacles: this.obstacles,
      players: Object.values(this.players).map((p) => ({
        slot: p.slot,
        nickname: p.nickname,
        isAI: p.isAI,
        alive: p.alive,
        score: Math.round(p.score),
        color: p.color,
        body: p.body,
      })),
    };
  }

  destroy() {
    this.running = false;
    clearTimeout(this.timer);
  }
}
