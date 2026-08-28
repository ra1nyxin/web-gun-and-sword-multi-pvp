import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Matter from "matter-js";
import { Server } from "socket.io";
import {
  DEV_SOCKET_PORT,
  InputState,
  PLATFORMS,
  PORT,
  PlayerState,
  SPAWNS,
  Snapshot,
  WORLD,
} from "../shared/game.js";

const { Bodies, Body, Engine, Query, World } = Matter;

const app = express();
const httpServer = createServer(app);
const isProduction = process.env.NODE_ENV === "production";
const socketPort = isProduction ? PORT : DEV_SOCKET_PORT;
const io = new Server(httpServer, {
  cors: isProduction ? undefined : { origin: "http://localhost:25653" },
  pingTimeout: 10_000,
});

const engine = Engine.create({
  gravity: { x: 0, y: WORLD.gravityY },
});
engine.positionIterations = 8;
engine.velocityIterations = 6;

const terrain = PLATFORMS.map((platform) =>
  Bodies.rectangle(platform.x, platform.y, platform.width, platform.height, {
    isStatic: true,
    friction: 0.85,
    label: "terrain",
  }),
);
World.add(engine.world, terrain);

type Player = {
  id: string;
  name: string;
  body: Matter.Body;
  input: InputState;
  health: number;
  kills: number;
  deaths: number;
  dead: boolean;
  respawnAt: number;
  lastShotAt: number;
  lastSlashAt: number;
  slashUntil: number;
  swingHits: Set<string>;
};

type Bullet = {
  id: string;
  ownerId: string;
  body: Matter.Body;
  expiresAt: number;
};

const players = new Map<string, Player>();
const bullets = new Map<string, Bullet>();
let bulletSequence = 0;
let spawnSequence = 0;

const emptyInput = (): InputState => ({
  left: false,
  right: false,
  jump: false,
  aimX: 1,
  aimY: 0,
});

function getSpawn() {
  const spawn = SPAWNS[spawnSequence % SPAWNS.length];
  spawnSequence += 1;
  return spawn;
}

function normalizeAim(input: InputState) {
  const length = Math.hypot(input.aimX, input.aimY) || 1;
  return { x: input.aimX / length, y: input.aimY / length };
}

function playerState(player: Player, now: number): PlayerState {
  const aim = normalizeAim(player.input);
  return {
    id: player.id,
    name: player.name,
    x: player.body.position.x,
    y: player.body.position.y,
    vx: player.body.velocity.x,
    vy: player.body.velocity.y,
    aimX: aim.x,
    aimY: aim.y,
    health: player.health,
    kills: player.kills,
    deaths: player.deaths,
    dead: player.dead,
    slashUntil: Math.max(0, player.slashUntil - now),
  };
}

function isGrounded(player: Player) {
  const bounds = player.body.bounds;
  const feetY = bounds.max.y;
  return PLATFORMS.some((platform) => {
    const top = platform.y - platform.height / 2;
    const left = platform.x - platform.width / 2;
    const right = platform.x + platform.width / 2;
    const overlapsX = bounds.max.x > left + 4 && bounds.min.x < right - 4;
    return overlapsX && feetY >= top - 5 && feetY <= top + 9 && player.body.velocity.y >= -1;
  });
}

function respawn(player: Player) {
  const spawn = getSpawn();
  player.health = WORLD.maxHealth;
  player.dead = false;
  player.respawnAt = 0;
  player.input.jump = false;
  Body.setPosition(player.body, spawn);
  Body.setVelocity(player.body, { x: 0, y: 0 });
  Body.setAngle(player.body, 0);
  player.body.collisionFilter.mask = 0xffffffff;
}

function damage(target: Player, attacker: Player, amount: number, now: number) {
  if (target.dead || target.id === attacker.id) return;
  target.health = Math.max(0, target.health - amount);
  if (target.health > 0) return;

  target.dead = true;
  target.deaths += 1;
  target.respawnAt = now + 1_800;
  target.body.collisionFilter.mask = 0;
  Body.setVelocity(target.body, { x: 0, y: 0 });
  attacker.kills += 1;
}

function removeBullet(id: string) {
  const bullet = bullets.get(id);
  if (!bullet) return;
  World.remove(engine.world, bullet.body);
  bullets.delete(id);
}

function shoot(player: Player, now: number) {
  if (player.dead || now - player.lastShotAt < 230) return;
  player.lastShotAt = now;
  const aim = normalizeAim(player.input);
  const origin = {
    x: player.body.position.x + aim.x * 25,
    y: player.body.position.y + aim.y * 7,
  };
  const body = Bodies.circle(origin.x, origin.y, 5, {
    isSensor: true,
    frictionAir: 0,
    label: "bullet",
  });
  Body.setVelocity(body, { x: aim.x * 19, y: aim.y * 19 });
  const id = `b${bulletSequence += 1}`;
  bullets.set(id, { id, ownerId: player.id, body, expiresAt: now + 1_250 });
  World.add(engine.world, body);
}

function slash(player: Player, now: number) {
  if (player.dead || now - player.lastSlashAt < 560) return;
  player.lastSlashAt = now;
  player.slashUntil = now + 155;
  player.swingHits.clear();
}

function resolveSwordSwings(now: number) {
  for (const attacker of players.values()) {
    if (attacker.dead || attacker.slashUntil < now) continue;
    const aim = normalizeAim(attacker.input);
    for (const target of players.values()) {
      if (target.dead || target.id === attacker.id || attacker.swingHits.has(target.id)) continue;
      const dx = target.body.position.x - attacker.body.position.x;
      const dy = target.body.position.y - attacker.body.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 82 || distance < 0.01) continue;
      const facing = (dx * aim.x + dy * aim.y) / distance;
      if (facing < 0.28) continue;
      attacker.swingHits.add(target.id);
      damage(target, attacker, 42, now);
    }
  }
}

function resolveBullets(now: number) {
  for (const bullet of [...bullets.values()]) {
    if (bullet.expiresAt <= now || !Number.isFinite(bullet.body.position.x)) {
      removeBullet(bullet.id);
      continue;
    }
    if (Query.collides(bullet.body, terrain).length > 0) {
      removeBullet(bullet.id);
      continue;
    }
    for (const target of players.values()) {
      if (target.dead || target.id === bullet.ownerId) continue;
      if (Query.collides(bullet.body, [target.body]).length === 0) continue;
      const attacker = players.get(bullet.ownerId);
      if (attacker) damage(target, attacker, 24, now);
      removeBullet(bullet.id);
      break;
    }
  }
}

function updatePlayerMovement(player: Player) {
  if (player.dead) return;
  const direction = Number(player.input.right) - Number(player.input.left);
  const currentY = player.body.velocity.y;
  Body.setVelocity(player.body, { x: direction * WORLD.playerSpeed, y: currentY });
  if (player.input.jump && isGrounded(player)) {
    Body.setVelocity(player.body, { x: direction * WORLD.playerSpeed, y: WORLD.jumpVelocity });
  }
  player.input.jump = false;
}

function snapshot(now: number): Snapshot {
  return {
    serverTime: now,
    players: [...players.values()].map((player) => playerState(player, now)),
    bullets: [...bullets.values()].map((bullet) => ({
      id: bullet.id,
      x: bullet.body.position.x,
      y: bullet.body.position.y,
    })),
  };
}

io.on("connection", (socket) => {
  const spawn = getSpawn();
  const player: Player = {
    id: socket.id,
    name: `Fighter ${players.size + 1}`,
    body: Bodies.rectangle(spawn.x, spawn.y, WORLD.playerWidth, WORLD.playerHeight, {
      friction: 0,
      frictionAir: 0.04,
      restitution: 0,
      label: "player",
      inertia: Infinity,
    }),
    input: emptyInput(),
    health: WORLD.maxHealth,
    kills: 0,
    deaths: 0,
    dead: false,
    respawnAt: 0,
    lastShotAt: 0,
    lastSlashAt: 0,
    slashUntil: 0,
    swingHits: new Set(),
  };
  players.set(socket.id, player);
  World.add(engine.world, player.body);
  socket.emit("welcome", { id: socket.id });

  socket.on("input", (candidate: Partial<InputState>) => {
    if (typeof candidate.left === "boolean") player.input.left = candidate.left;
    if (typeof candidate.right === "boolean") player.input.right = candidate.right;
    if (candidate.jump === true) player.input.jump = true;
    if (Number.isFinite(candidate.aimX)) player.input.aimX = Number(candidate.aimX);
    if (Number.isFinite(candidate.aimY)) player.input.aimY = Number(candidate.aimY);
  });
  socket.on("shoot", () => shoot(player, Date.now()));
  socket.on("slash", () => slash(player, Date.now()));
  socket.on("disconnect", () => {
    players.delete(socket.id);
    World.remove(engine.world, player.body);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const player of players.values()) {
    if (player.dead && player.respawnAt <= now) respawn(player);
    updatePlayerMovement(player);
  }
  Engine.update(engine, 1000 / 60);
  resolveSwordSwings(now);
  resolveBullets(now);
}, 1000 / 60);

setInterval(() => {
  io.emit("snapshot", snapshot(Date.now()));
}, 1000 / 20);

app.get("/health", (_request, response) => {
  response.json({ ok: true, players: players.size });
});

if (isProduction) {
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  const clientDirectory = path.resolve(dirname, "../../client");
  app.use(express.static(clientDirectory));
  app.get("/{*splat}", (_request, response) => {
    response.sendFile(path.join(clientDirectory, "index.html"));
  });
}

httpServer.listen(socketPort, "0.0.0.0", () => {
  console.log(`Gun & Sword server listening on http://0.0.0.0:${socketPort}`);
});
