// Snake Survival — online 2-player game server.
// Matches players into rooms (2 humans, or 1 human + AI after a short wait),
// runs each room's authoritative game loop, and persists scores to the leaderboard.
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Room } from './room.js';
import { recordScore, getTopScores } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const AI_WAIT_MS = 5000; // wait this long for a 2nd human before adding AI

const rooms = new Map();       // roomId -> Room
const socketRoom = new Map();  // socketId -> roomId
let waitingRoom = null;        // a Room with one human waiting for a partner
let waitTimer = null;

async function broadcastLeaderboard(target = io) {
  target.emit('leaderboard', await getTopScores(10));
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.destroy();
  rooms.delete(roomId);
  for (const p of Object.values(room.players)) {
    if (p.socketId) socketRoom.delete(p.socketId);
  }
  if (waitingRoom && waitingRoom.id === roomId) {
    waitingRoom = null;
    clearTimeout(waitTimer);
  }
}

function makeRoom() {
  const room = new Room({
    onState: (roomId, state) => io.to(roomId).emit('state', state),
    onGameOver: (roomId, results) => handleGameOver(roomId, results),
  });
  rooms.set(room.id, room);
  return room;
}

function startRoom(room) {
  if (waitingRoom && waitingRoom.id === room.id) {
    waitingRoom = null;
    clearTimeout(waitTimer);
  }
  io.to(room.id).emit('start', room.serialize());
  room.start();
}

async function handleGameOver(roomId, results) {
  const room = rooms.get(roomId);
  // Persist human scores to the permanent leaderboard.
  for (const r of results) {
    if (!r.isAI && r.nickname) {
      await recordScore({
        nickname: r.nickname,
        score: r.score,
        food: r.food,
        seconds: r.seconds,
        level: r.level,
      });
    }
  }
  const board = await getTopScores(10);
  io.to(roomId).emit('gameover', { results, leaderboard: board });
  broadcastLeaderboard(); // refresh everyone's start-screen board
  // Tear the room down shortly after; clients re-queue via "play again".
  setTimeout(() => cleanupRoom(roomId), 1500);
}

io.on('connection', (socket) => {
  // Send the current leaderboard immediately so the start screen is populated.
  getTopScores(10).then((board) => socket.emit('leaderboard', board));

  socket.on('join', (rawName) => {
    const nickname = String(rawName || '').trim().slice(0, 16) || 'Player';

    // Already in a room? Ignore duplicate joins.
    if (socketRoom.get(socket.id)) return;

    let room;
    if (waitingRoom && waitingRoom.hasOpenHumanSlot()) {
      // Pair with the waiting human and start immediately.
      room = waitingRoom;
      room.addPlayer({ socketId: socket.id, nickname });
      socket.join(room.id);
      socketRoom.set(socket.id, room.id);
      startRoom(room);
    } else {
      // Create a new room, wait briefly for a partner, then fall back to AI.
      room = makeRoom();
      room.addPlayer({ socketId: socket.id, nickname });
      socket.join(room.id);
      socketRoom.set(socket.id, room.id);
      waitingRoom = room;
      socket.emit('waiting', { seconds: AI_WAIT_MS / 1000 });
      clearTimeout(waitTimer);
      waitTimer = setTimeout(() => {
        if (waitingRoom && waitingRoom.id === room.id && !room.running) {
          room.addPlayer({ socketId: null, nickname: 'CPU', isAI: true });
          startRoom(room);
        }
      }, AI_WAIT_MS);
    }
  });

  socket.on('dir', (dir) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId && rooms.get(roomId);
    if (room) room.setDirection(socket.id, dir);
  });

  socket.on('disconnect', () => {
    const roomId = socketRoom.get(socket.id);
    socketRoom.delete(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (!room.running) {
      // Was just waiting — drop the room entirely.
      cleanupRoom(roomId);
    } else {
      // Mid-game: hand the snake to the AI so the opponent can finish.
      room.handleDisconnect(socket.id);
      // If no humans remain in the room, end it.
      if (room.playerCount === 0) cleanupRoom(roomId);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🐍 Snake Survival running at http://localhost:${PORT}`);
});
