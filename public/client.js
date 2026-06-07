/* global io */
const socket = io();

const startScreen = document.getElementById('start-screen');
const gameScreen = document.getElementById('game-screen');
const overScreen = document.getElementById('over-screen');
const joinForm = document.getElementById('join-form');
const nicknameInput = document.getElementById('nickname');
const statusBanner = document.getElementById('status-banner');
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let myNickname = '';
let mySlot = null;     // which slot is "me" (matched by nickname on start)
let latestState = null;

// Remember nickname between rounds.
nicknameInput.value = localStorage.getItem('snake_nick') || '';

function show(screen) {
  for (const s of [startScreen, gameScreen, overScreen]) s.classList.add('hidden');
  screen.classList.remove('hidden');
}

// ---- Joining ----------------------------------------------------------
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  myNickname = nicknameInput.value.trim().slice(0, 16) || 'Player';
  localStorage.setItem('snake_nick', myNickname);
  socket.emit('join', myNickname);
  statusBanner.textContent = '';
});

document.getElementById('play-again').addEventListener('click', () => {
  socket.emit('join', myNickname);
  show(gameScreen);
  statusBanner.textContent = 'Waiting for a match…';
});

// ---- Socket events ----------------------------------------------------
socket.on('leaderboard', (board) => {
  renderLeaderboard(document.getElementById('leaderboard-list'), board);
  renderLeaderboard(document.getElementById('leaderboard-list-2'), board);
});

socket.on('waiting', ({ seconds }) => {
  show(gameScreen);
  statusBanner.textContent = `Waiting up to ${seconds}s for another player…`;
  clearBoard();
});

socket.on('start', (state) => {
  show(gameScreen);
  statusBanner.textContent = '';
  // Figure out which snake is me (first slot matching my nickname that isn't AI).
  mySlot = null;
  for (const p of state.players) {
    if (!p.isAI && p.nickname === myNickname && mySlot === null) mySlot = p.slot;
  }
  latestState = state;
  render(state);
});

socket.on('state', (state) => {
  latestState = state;
  render(state);
});

socket.on('gameover', ({ results, leaderboard }) => {
  renderResults(results);
  renderLeaderboard(document.getElementById('leaderboard-list-2'), leaderboard);
  show(overScreen);
});

// ---- Controls ---------------------------------------------------------
const keyMap = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};
window.addEventListener('keydown', (e) => {
  const dir = keyMap[e.key];
  if (!dir) return;
  e.preventDefault();
  socket.emit('dir', dir);
});

// Touch / swipe controls for mobile.
let touchStart = null;
canvas.addEventListener('touchstart', (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
  if (Math.abs(dx) > Math.abs(dy)) socket.emit('dir', dx > 0 ? 'right' : 'left');
  else socket.emit('dir', dy > 0 ? 'down' : 'up');
  touchStart = null;
}, { passive: true });

// ---- Rendering --------------------------------------------------------
function clearBoard() {
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function render(state) {
  const cell = canvas.width / state.cols;
  clearBoard();

  // Grid dots
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let x = 0; x < state.cols; x++) {
    for (let y = 0; y < state.rows; y++) {
      ctx.fillRect(x * cell + cell / 2 - 1, y * cell + cell / 2 - 1, 2, 2);
    }
  }

  // Obstacles
  ctx.fillStyle = '#475569';
  for (const o of state.obstacles) {
    roundRect(o.x * cell, o.y * cell, cell, cell, 3);
  }

  // Food
  if (state.food) {
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(state.food.x * cell + cell / 2, state.food.y * cell + cell / 2, cell / 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Snakes
  for (const p of state.players) {
    ctx.fillStyle = p.alive ? p.color : '#64748b';
    p.body.forEach((seg, i) => {
      const pad = i === 0 ? 1 : 2;
      roundRect(seg.x * cell + pad, seg.y * cell + pad, cell - pad * 2, cell - pad * 2, 4);
      if (i === 0) {
        // eye on the head
        ctx.save();
        ctx.fillStyle = '#0b1220';
        ctx.beginPath();
        ctx.arc(seg.x * cell + cell / 2, seg.y * cell + cell / 2, cell / 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  }

  updateHud(state);
  updateSpectatorBanner(state);
}

// When your own snake has died, the round keeps running for your opponent
// ("last one alive wins"). Tell the player that instead of leaving them
// staring at a frozen grey snake — otherwise it looks like the game hung.
function updateSpectatorBanner(state) {
  const me = mySlot !== null ? state.players.find((p) => p.slot === mySlot) : null;
  const ending = typeof state.endsIn === 'number';
  const countdown = ending ? ` Ending in ${state.endsIn}…` : '';
  if (me && !me.alive) {
    statusBanner.textContent = `💥 You crashed!${countdown}`;
    statusBanner.classList.add('dead');
  } else if (ending && me && me.alive) {
    statusBanner.textContent = `Rival crashed!${countdown}`;
    statusBanner.classList.add('dead');
  } else if (statusBanner.classList.contains('dead')) {
    statusBanner.textContent = '';
    statusBanner.classList.remove('dead');
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function updateHud(state) {
  const p0 = state.players.find((p) => p.slot === 0);
  const p1 = state.players.find((p) => p.slot === 1);
  setHud('hud-p0', p0);
  setHud('hud-p1', p1);
  document.getElementById('level').textContent = 'Lv ' + state.level;
  const timer = document.getElementById('timer');
  timer.textContent = formatTime(state.elapsed);
  timer.classList.toggle('hard', state.hardMode);
}

function setHud(id, p) {
  const el = document.getElementById(id);
  if (!p) return;
  el.querySelector('.name').textContent = p.nickname + (p.isAI ? ' 🤖' : '');
  el.querySelector('.score').textContent = p.score;
  el.style.opacity = p.alive ? '1' : '0.5';
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderLeaderboard(listEl, board) {
  if (!listEl) return;
  if (!board || board.length === 0) {
    listEl.innerHTML = '<li class="empty">No scores yet — be the first!</li>';
    return;
  }
  listEl.innerHTML = board.map((row, i) => `
    <li>
      <span class="rank">${i + 1}.</span>
      <span class="who">${escapeHtml(row.nickname)}</span>
      <span class="pts">${row.score}</span>
    </li>`).join('');
}

function renderResults(results) {
  const medals = ['🥇', '🥈'];
  const container = document.getElementById('results');
  container.innerHTML = results.map((r, i) => {
    const isMe = !r.isAI && r.nickname === myNickname;
    return `
      <div class="result-row ${i === 0 ? 'winner' : ''}">
        <div>
          <span class="medal">${medals[i] || ''}</span>
          <b>${escapeHtml(r.nickname)}${r.isAI ? ' 🤖' : ''}${isMe ? ' (you)' : ''}</b>
          <div class="r-meta">${r.food} food · ${r.seconds}s survived · reached Lv ${r.level}</div>
        </div>
        <span class="r-score">${r.score}</span>
      </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
