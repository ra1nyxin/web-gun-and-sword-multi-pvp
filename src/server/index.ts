import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Matter from "matter-js";
import { Server } from "socket.io";
import {
  DEV_SOCKET_PORT,
  CasingEvent,
  ChatMessage,
  DamageEvent,
  ELEVATORS,
  ElevatorState,
  INVENTORY_SIZE,
  ImpactEvent,
  InputState,
  InventorySlot,
  InventoryState,
  ItemId,
  ITEMS,
  KillEvent,
  LOOT_SPAWNS,
  PLATFORMS,
  PORT,
  PlayerState,
  SPAWNS,
  Snapshot,
  ShotEvent,
  STARTING_INVENTORY,
  WORLD,
  ZONES,
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

const engine = Engine.create({ gravity: { x: 0, y: WORLD.gravityY } });
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

const elevatorBodies = ELEVATORS.map((elevator) =>
  Bodies.rectangle(elevator.x, (elevator.minY + elevator.maxY) / 2, elevator.width, elevator.height, {
    isStatic: true,
    friction: 0.85,
    label: "elevator",
  }),
);
World.add(engine.world, elevatorBodies);
const solidTerrain = [...terrain, ...elevatorBodies];

type NavigationSurface = {
  id: string;
  x: number;
  top: number;
  width: number;
  left: number;
  right: number;
};

const staticNavigationSurfaces: NavigationSurface[] = PLATFORMS
  .map((platform, index) => ({
    id: `platform:${index}`,
    x: platform.x,
    top: platform.y - platform.height / 2,
    width: platform.width,
    left: platform.x - platform.width / 2,
    right: platform.x + platform.width / 2,
  }))
  .filter((surface) => surface.width >= 40);

function navigationSurfaces(): NavigationSurface[] {
  return [
    ...staticNavigationSurfaces,
    ...elevatorBodies.map((body, index) => ({
      id: `elevator:${ELEVATORS[index].id}`,
      x: body.position.x,
      top: body.bounds.min.y,
      width: ELEVATORS[index].width,
      left: body.bounds.min.x,
      right: body.bounds.max.x,
    })),
  ];
}

type BotBrain = {
  targetId: string | null;
  nextThinkAt: number;
  nextAttackAt: number;
  nextJumpAt: number;
  strafeDirection: number;
  navigationRoute: string[];
  navigationIndex: number;
};

type Player = {
  id: string;
  name: string;
  body: Matter.Body;
  input: InputState;
  inventory: InventorySlot[];
  selectedSlot: number;
  cooldowns: Record<ItemId, number>;
  health: number;
  kills: number;
  deaths: number;
  dead: boolean;
  respawnAt: number;
  invulnerableUntil: number;
  pendingDrops: ItemId[];
  slashUntil: number;
  swingHits: Set<string>;
  lastNoticeAt: number;
  lastChatAt: number;
  isBot: boolean;
  bot: BotBrain | null;
};

type Bullet = {
  id: string;
  item: ItemId;
  ownerId: string;
  body: Matter.Body;
  expiresAt: number;
};

type Pickup = {
  id: string;
  item: ItemId;
  body: Matter.Body;
  protectedOwnerId: string | null;
  ownerProtectionUntil: number;
  isWorld: boolean;
};

const players = new Map<string, Player>();
const bullets = new Map<string, Bullet>();
const pickups = new Map<string, Pickup>();
const MAX_PICKUPS_PER_ITEM = 10;
const killFeed: KillEvent[] = [];
const chatMessages: ChatMessage[] = [];
const lootCycle: ItemId[] = ["scattergun", "plasma", "medkit", "rifle", "sword", "pistol"];

let bulletSequence = 0;
let pickupSequence = 0;
let playerSequence = 0;
let spawnSequence = 0;
let lootSequence = 0;
let killSequence = 0;
let chatSequence = 0;

const emptyInput = (): InputState => ({
  left: false,
  right: false,
  jump: false,
  aimX: 1,
  aimY: 0,
});

const emptyCooldowns = (): Record<ItemId, number> => ({
  sword: 0,
  pistol: 0,
  rifle: 0,
  scattergun: 0,
  plasma: 0,
  medkit: 0,
});

function getSpawn() {
  const spawn = SPAWNS[spawnSequence % SPAWNS.length];
  spawnSequence += 1;
  return spawn;
}

function updateElevators(now: number) {
  for (let index = 0; index < ELEVATORS.length; index += 1) {
    const definition = ELEVATORS[index];
    const body = elevatorBodies[index];
    const previousY = body.position.y;
    const progress = 0.5 + Math.sin(now * definition.speed + definition.phase) * 0.5;
    const nextY = definition.minY + (definition.maxY - definition.minY) * progress;
    const deltaY = nextY - previousY;
    if (Math.abs(deltaY) < 0.001) continue;
    Body.setPosition(body, { x: definition.x, y: nextY });
    for (const player of players.values()) {
      if (player.dead) continue;
      const bounds = player.body.bounds;
      const wasOverlappingX = bounds.max.x > definition.x - definition.width / 2 + 4 && bounds.min.x < definition.x + definition.width / 2 - 4;
      const wasOnTop = bounds.max.y >= previousY - definition.height / 2 - 7 && bounds.max.y <= previousY - definition.height / 2 + 12;
      if (wasOverlappingX && wasOnTop) Body.translate(player.body, { x: 0, y: deltaY });
    }
    for (const pickup of pickups.values()) {
      const bounds = pickup.body.bounds;
      const wasOverlappingX = bounds.max.x > definition.x - definition.width / 2 + 2 && bounds.min.x < definition.x + definition.width / 2 - 2;
      const wasOnTop = bounds.max.y >= previousY - definition.height / 2 - 6 && bounds.max.y <= previousY - definition.height / 2 + 10;
      if (wasOverlappingX && wasOnTop) Body.translate(pickup.body, { x: 0, y: deltaY });
    }
  }
}

function activeItem(player: Player) {
  return player.inventory[player.selectedSlot] ?? null;
}

function inventoryState(player: Player): InventoryState {
  return { slots: [...player.inventory], selectedSlot: player.selectedSlot };
}

function syncInventory(player: Player) {
  io.to(player.id).emit("inventory", inventoryState(player));
}

function notice(player: Player, message: string, now: number) {
  if (now - player.lastNoticeAt < 450) return;
  player.lastNoticeAt = now;
  io.to(player.id).emit("notice", { message });
}

function sanitizeChat(candidate: unknown) {
  if (typeof candidate !== "string") return null;
  const normalized = candidate
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, 240).join("");
}

function sanitizePlayerName(candidate: unknown) {
  if (typeof candidate !== "string") return null;
  const normalized = candidate
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, 16).join("");
}

function setPlayerName(player: Player, candidate: unknown, now: number) {
  const name = sanitizePlayerName(candidate);
  if (!name) {
    notice(player, "昵称不能为空", now);
    return;
  }
  player.name = name;
  io.to(player.id).emit("name", { name });
  notice(player, "昵称已更新", now);
}

function sendChat(player: Player, candidate: unknown, now: number) {
  if (now - player.lastChatAt < 700) {
    notice(player, "发送过快", now);
    return;
  }
  const text = sanitizeChat(candidate);
  if (!text) {
    notice(player, "消息不能为空", now);
    return;
  }
  player.lastChatAt = now;
  chatSequence += 1;
  const message: ChatMessage = {
    id: `c${chatSequence}`,
    sender: player.name,
    text,
    sentAt: now,
  };
  chatMessages.push(message);
  chatMessages.splice(0, Math.max(0, chatMessages.length - 60));
  io.emit("chat", message);
}

function normalizeAim(input: InputState) {
  const length = Math.hypot(input.aimX, input.aimY) || 1;
  return { x: input.aimX / length, y: input.aimY / length };
}

function segmentHitsRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  let enter = 0;
  let exit = 1;
  for (const [origin, delta, min, max] of [[startX, deltaX, left, right], [startY, deltaY, top, bottom]] as const) {
    if (Math.abs(delta) < 0.0001) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const inverse = 1 / delta;
    let near = (min - origin) * inverse;
    let far = (max - origin) * inverse;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    exit = Math.min(exit, far);
    if (enter > exit) return false;
  }
  return exit > 0.08 && enter < 0.92;
}

function hasLineOfSight(source: Player, target: Player) {
  const startX = source.body.position.x;
  const startY = source.body.position.y - 18;
  const endX = target.body.position.x;
  const endY = target.body.position.y - 18;
  for (const platform of PLATFORMS) {
    if (segmentHitsRect(startX, startY, endX, endY, platform.x - platform.width / 2, platform.y - platform.height / 2, platform.x + platform.width / 2, platform.y + platform.height / 2)) {
      return false;
    }
  }
  for (const elevator of elevatorBodies) {
    if (segmentHitsRect(startX, startY, endX, endY, elevator.bounds.min.x, elevator.bounds.min.y, elevator.bounds.max.x, elevator.bounds.max.y)) {
      return false;
    }
  }
  return true;
}

function bulletPathClear(bullet: Bullet, target: Player) {
  for (const platform of PLATFORMS) {
    if (segmentHitsRect(bullet.body.position.x, bullet.body.position.y, target.body.position.x, target.body.position.y, platform.x - platform.width / 2, platform.y - platform.height / 2, platform.x + platform.width / 2, platform.y + platform.height / 2)) {
      return false;
    }
  }
  for (const elevator of elevatorBodies) {
    if (segmentHitsRect(bullet.body.position.x, bullet.body.position.y, target.body.position.x, target.body.position.y, elevator.bounds.min.x, elevator.bounds.min.y, elevator.bounds.max.x, elevator.bounds.max.y)) {
      return false;
    }
  }
  return true;
}

function findBotTarget(bot: Player) {
  return [...players.values()]
    .filter((candidate) => candidate.id !== bot.id && !candidate.dead)
    .sort((left, right) => {
      const leftVisible = hasLineOfSight(bot, left) ? 0 : 1;
      const rightVisible = hasLineOfSight(bot, right) ? 0 : 1;
      if (leftVisible !== rightVisible) return leftVisible - rightVisible;
      const leftDistance = Math.hypot(left.body.position.x - bot.body.position.x, left.body.position.y - bot.body.position.y);
      const rightDistance = Math.hypot(right.body.position.x - bot.body.position.x, right.body.position.y - bot.body.position.y);
      return leftDistance - rightDistance;
    })[0] ?? null;
}

function incomingBulletDodge(bot: Player) {
  let closestDistance = Infinity;
  let dodgeDirection = 0;
  for (const bullet of bullets.values()) {
    if (bullet.ownerId === bot.id) continue;
    if (!bulletPathClear(bullet, bot)) continue;
    const velocity = bullet.body.velocity;
    const speedSquared = velocity.x * velocity.x + velocity.y * velocity.y;
    if (speedSquared < 0.01) continue;
    const offsetX = bot.body.position.x - bullet.body.position.x;
    const offsetY = bot.body.position.y - bullet.body.position.y;
    const projectedTime = Math.max(0, Math.min(18, (offsetX * velocity.x + offsetY * velocity.y) / speedSquared));
    const closestX = bullet.body.position.x + velocity.x * projectedTime;
    const closestY = bullet.body.position.y + velocity.y * projectedTime;
    const distance = Math.hypot(bot.body.position.x - closestX, bot.body.position.y - closestY);
    if (distance > 78 || distance >= closestDistance) continue;
    closestDistance = distance;
    const perpendicularX = -velocity.y;
    const perpendicularY = velocity.x;
    const side = offsetX * perpendicularX + offsetY * perpendicularY;
    const awayX = side >= 0 ? perpendicularX : -perpendicularX;
    dodgeDirection = Math.sign(awayX) || bot.bot?.strafeDirection || 1;
  }
  return dodgeDirection || null;
}

function botWeaponSlot(bot: Player, distance: number) {
  if (bot.health <= 42) {
    const medkitSlot = bot.inventory.indexOf("medkit");
    if (medkitSlot !== -1) return medkitSlot;
  }
  if (distance <= 92) {
    const swordSlot = bot.inventory.indexOf("sword");
    if (swordSlot !== -1) return swordSlot;
  }
  if (distance <= 310) {
    const scattergunSlot = bot.inventory.indexOf("scattergun");
    if (scattergunSlot !== -1) return scattergunSlot;
  }
  const rifleSlot = bot.inventory.indexOf("rifle");
  if (rifleSlot !== -1) return rifleSlot;
  const pistolSlot = bot.inventory.indexOf("pistol");
  if (pistolSlot !== -1) return pistolSlot;
  return bot.inventory.findIndex((item) => item !== null);
}

function surfaceForPlayer(player: Player, surfaces: NavigationSurface[]) {
  const feet = player.body.bounds.max.y;
  let best: NavigationSurface | null = null;
  let bestScore = Infinity;
  for (const surface of surfaces) {
    const overlapsX = player.body.bounds.max.x > surface.left - 8 && player.body.bounds.min.x < surface.right + 8;
    const verticalDistance = Math.abs(feet - surface.top);
    if (!overlapsX || verticalDistance > 34) continue;
    const score = verticalDistance + Math.abs(player.body.position.x - surface.x) * 0.008;
    if (score < bestScore) {
      best = surface;
      bestScore = score;
    }
  }
  return best;
}

function nearestSurfaceForPlayer(player: Player, surfaces: NavigationSurface[]) {
  return surfaces.reduce<NavigationSurface | null>((best, surface) => {
    if (!best) return surface;
    const bestScore = Math.abs(player.body.position.y - best.top) + Math.abs(player.body.position.x - best.x) * 0.18;
    const score = Math.abs(player.body.position.y - surface.top) + Math.abs(player.body.position.x - surface.x) * 0.18;
    return score < bestScore ? surface : best;
  }, null);
}

function surfaceReachable(from: NavigationSurface, to: NavigationSurface) {
  const verticalGap = Math.abs(to.top - from.top);
  if (verticalGap > 175) return false;
  const horizontalGap = Math.max(from.left - to.right, to.left - from.right, 0);
  return horizontalGap <= 245 || verticalGap <= 68;
}

function findNavigationRoute(bot: Player, target: Player) {
  const surfaces = navigationSurfaces();
  const current = surfaceForPlayer(bot, surfaces) ?? nearestSurfaceForPlayer(bot, surfaces);
  const destination = surfaceForPlayer(target, surfaces) ?? nearestSurfaceForPlayer(target, surfaces);
  if (!current || !destination || current.id === destination.id) return [];

  const queue = [current.id];
  const previous = new Map<string, string | null>([[current.id, null]]);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === destination.id) break;
    const from = surfaces.find((surface) => surface.id === id);
    if (!from) continue;
    for (const to of surfaces) {
      if (to.id === from.id || previous.has(to.id) || !surfaceReachable(from, to)) continue;
      previous.set(to.id, from.id);
      queue.push(to.id);
    }
  }
  if (!previous.has(destination.id)) return [];
  const route: string[] = [];
  let cursor: string | null = destination.id;
  while (cursor) {
    route.unshift(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return route;
}

function navigationGoal(bot: Player, target: Player, brain: BotBrain) {
  const surfaces = navigationSurfaces();
  const current = surfaceForPlayer(bot, surfaces);
  if (!current) return null;
  const targetSurface = surfaceForPlayer(target, surfaces) ?? nearestSurfaceForPlayer(target, surfaces);
  if (!targetSurface || targetSurface.id === current.id) return null;
  const currentRouteId = brain.navigationRoute[brain.navigationIndex];
  if (currentRouteId !== current.id || brain.navigationIndex >= brain.navigationRoute.length - 1) {
    brain.navigationRoute = findNavigationRoute(bot, target);
    brain.navigationIndex = brain.navigationRoute[0] === current.id ? 0 : -1;
  }
  if (brain.navigationIndex < 0 || brain.navigationIndex >= brain.navigationRoute.length - 1) return null;
  const nextId = brain.navigationRoute[brain.navigationIndex + 1];
  const next = surfaces.find((surface) => surface.id === nextId);
  if (!next) return null;
  if (bot.body.bounds.max.x >= next.left - 18 && bot.body.bounds.min.x <= next.right + 18 && Math.abs(bot.body.bounds.max.y - next.top) < 28) {
    brain.navigationIndex += 1;
  }
  const destinationX = Math.max(next.left + 18, Math.min(next.right - 18, target.body.position.x));
  const horizontalGap = Math.max(current.left - next.right, next.left - current.right, 0);
  return { x: destinationX, jump: next.top < current.top - 25 || horizontalGap > 10 };
}

function updateBotAI(bot: Player, now: number) {
  const brain = bot.bot;
  if (!brain || bot.dead) return;
  bot.input.jump = false;
  if (now >= brain.nextThinkAt || !brain.targetId || players.get(brain.targetId)?.dead) {
    brain.targetId = findBotTarget(bot)?.id ?? null;
    brain.nextThinkAt = now + 180 + Math.random() * 160;
    if (Math.random() < 0.35) brain.strafeDirection *= -1;
    brain.navigationRoute = [];
    brain.navigationIndex = 0;
  }

  const target = brain.targetId ? players.get(brain.targetId) ?? null : null;
  const dodgeDirection = incomingBulletDodge(bot);
  let moveDirection = dodgeDirection ?? brain.strafeDirection;
  if (target) {
    const dx = target.body.position.x - bot.body.position.x;
    const dy = target.body.position.y - bot.body.position.y;
    const distance = Math.hypot(dx, dy);
    const visible = hasLineOfSight(bot, target);
    const navigation = navigationGoal(bot, target, brain);
    const prediction = Math.min(14, distance / 20);
    bot.input.aimX = target.body.position.x + target.body.velocity.x * prediction - bot.body.position.x;
    bot.input.aimY = target.body.position.y + target.body.velocity.y * prediction - bot.body.position.y;
    if (dodgeDirection === null) {
      if (bot.health < 35 && bot.inventory.indexOf("medkit") === -1) moveDirection = -Math.sign(dx) || brain.strafeDirection;
      else if (navigation) moveDirection = Math.sign(navigation.x - bot.body.position.x) || brain.strafeDirection;
      else if (!visible || distance > 125) moveDirection = Math.sign(dx) || brain.strafeDirection;
      else if (distance < 70) moveDirection = -Math.sign(dx) || brain.strafeDirection;
    }
    const weaponSlot = botWeaponSlot(bot, distance);
    if (weaponSlot >= 0) {
      bot.selectedSlot = weaponSlot;
      if (now >= brain.nextAttackAt && (visible || distance < 100)) {
        useSelectedItem(bot, now);
        brain.nextAttackAt = now + 70 + Math.random() * 90;
      }
    }
    if (isGrounded(bot) && now >= brain.nextJumpAt && (navigation?.jump || dy < -58 || dodgeDirection !== null || Math.abs(dx) > 220)) {
      bot.input.jump = true;
      brain.nextJumpAt = now + 700 + Math.random() * 850;
    }
  } else {
    bot.input.aimX = brain.strafeDirection;
    bot.input.aimY = 0;
    if (now >= brain.nextJumpAt && isGrounded(bot) && Math.random() < 0.02) {
      bot.input.jump = true;
      brain.nextJumpAt = now + 900;
    }
  }
  if (bot.body.position.x < 80) moveDirection = 1;
  if (bot.body.position.x > WORLD.width - 80) moveDirection = -1;
  bot.input.left = moveDirection < 0;
  bot.input.right = moveDirection > 0;
}

function createBot(id: string, name: string, spawn: { x: number; y: number }) {
  const bot: Player = {
    id,
    name,
    body: Bodies.rectangle(spawn.x, spawn.y, WORLD.playerWidth, WORLD.playerHeight, {
      friction: 0,
      frictionAir: 0.04,
      restitution: 0,
      label: "player",
      inertia: Infinity,
    }),
    input: emptyInput(),
    inventory: ["rifle", "scattergun", "sword", "pistol", "medkit", null, null, null, null],
    selectedSlot: 0,
    cooldowns: emptyCooldowns(),
    health: WORLD.maxHealth,
    kills: 0,
    deaths: 0,
    dead: false,
    respawnAt: 0,
    invulnerableUntil: Date.now() + 3_000,
    pendingDrops: [],
    slashUntil: 0,
    swingHits: new Set(),
    lastNoticeAt: 0,
    lastChatAt: 0,
    isBot: true,
    bot: {
      targetId: null,
      nextThinkAt: 0,
      nextAttackAt: 0,
      nextJumpAt: 0,
      strafeDirection: Math.random() < 0.5 ? -1 : 1,
      navigationRoute: [],
      navigationIndex: 0,
    },
  };
  players.set(id, bot);
  World.add(engine.world, bot.body);
}

function playerState(player: Player, now: number): PlayerState {
  const aim = normalizeAim(player.input);
  const item = activeItem(player);
  const readyIn = item ? Math.max(0, player.cooldowns[item] + ITEMS[item].cooldown - now) : 0;
  return {
    id: player.id,
    name: player.name,
    x: player.body.position.x,
    y: player.body.position.y,
    vx: player.body.velocity.x,
    vy: player.body.velocity.y,
    health: player.health,
    kills: player.kills,
    deaths: player.deaths,
    dead: player.dead,
    aimX: aim.x,
    aimY: aim.y,
    activeItem: item,
    selectedSlot: player.selectedSlot,
    weaponReadyIn: readyIn,
    slashUntil: Math.max(0, player.slashUntil - now),
    invulnerableUntil: Math.max(0, player.invulnerableUntil - now),
  };
}

function isGrounded(player: Player) {
  const bounds = player.body.bounds;
  const feetY = bounds.max.y;
  const groundedOnTerrain = PLATFORMS.some((platform) => {
    const top = platform.y - platform.height / 2;
    const left = platform.x - platform.width / 2;
    const right = platform.x + platform.width / 2;
    const overlapsX = bounds.max.x > left + 4 && bounds.min.x < right - 4;
    return overlapsX && feetY >= top - 6 && feetY <= top + 10 && player.body.velocity.y >= -1;
  });
  if (groundedOnTerrain) return true;
  const groundedOnElevator = elevatorBodies.some((elevator) => {
    const elevatorBounds = elevator.bounds;
    const overlapsX = bounds.max.x > elevatorBounds.min.x + 4 && bounds.min.x < elevatorBounds.max.x - 4;
    return overlapsX && feetY >= elevatorBounds.min.y - 7 && feetY <= elevatorBounds.min.y + 11 && player.body.velocity.y >= -1;
  });
  if (groundedOnElevator) return true;
  return [...pickups.values()].some((pickup) => {
    const pickupBounds = pickup.body.bounds;
    const overlapsX = bounds.max.x > pickupBounds.min.x + 4 && bounds.min.x < pickupBounds.max.x - 4;
    return overlapsX && feetY >= pickupBounds.min.y - 7 && feetY <= pickupBounds.min.y + 11 && player.body.velocity.y >= -1;
  });
}

function respawn(player: Player, now: number) {
  const spawn = getSpawn();
  player.health = WORLD.maxHealth;
  player.dead = false;
  player.respawnAt = 0;
  player.invulnerableUntil = now + 3_000;
  player.input.jump = false;
  Body.setPosition(player.body, spawn);
  Body.setVelocity(player.body, { x: 0, y: 0 });
  Body.setAngle(player.body, 0);
  player.body.collisionFilter.mask = 0xffffffff;
}

function recordKill(attacker: Player, target: Player, item: ItemId) {
  killSequence += 1;
  killFeed.unshift({
    id: `k${killSequence}`,
    attacker: attacker.name,
    victim: target.name,
    item,
  });
  killFeed.splice(6);
}

function damage(target: Player, attacker: Player, amount: number, now: number, item: ItemId) {
  if (target.dead || target.id === attacker.id) return;
  if (target.invulnerableUntil > now) return;
  const appliedDamage = Math.min(amount, target.health);
  target.health = Math.max(0, target.health - appliedDamage);
  const damageEvent: DamageEvent = {
    targetId: target.id,
    x: target.body.position.x,
    y: target.body.position.y - 25,
    amount: appliedDamage,
    item,
  };
  io.emit("damage", damageEvent);
  if (target.health > 0) return;

  dropInventoryOnDeath(target, now);
  target.dead = true;
  target.deaths += 1;
  target.respawnAt = now + 1_800;
  target.body.collisionFilter.mask = 0;
  Body.setVelocity(target.body, { x: 0, y: 0 });
  attacker.kills += 1;
  recordKill(attacker, target, item);
}

function removeBullet(id: string, shouldImpact = false) {
  const bullet = bullets.get(id);
  if (!bullet) return;
  if (shouldImpact) {
    const impact: ImpactEvent = {
      bulletId: bullet.id,
      item: bullet.item,
      x: bullet.body.position.x,
      y: bullet.body.position.y,
    };
    io.emit("impact", impact);
  }
  World.remove(engine.world, bullet.body);
  bullets.delete(id);
}

function removePickup(id: string) {
  const pickup = pickups.get(id);
  if (!pickup) return;
  World.remove(engine.world, pickup.body);
  pickups.delete(id);
}

type PickupSpawnOptions = {
  protectedOwnerId?: string | null;
  ownerProtectionMs?: number;
  isWorld?: boolean;
  velocity?: { x: number; y: number };
  angularVelocity?: number;
};

function spawnPickup(
  item: ItemId,
  x: number,
  y: number,
  now: number,
  options: PickupSpawnOptions = {},
) {
  const itemCount = [...pickups.values()].filter((pickup) => pickup.item === item).length;
  if (itemCount >= MAX_PICKUPS_PER_ITEM) return null;

  pickupSequence += 1;
  const spawnX = Math.max(35, Math.min(WORLD.width - 35, x));
  const spawnY = Math.max(40, Math.min(WORLD.height - 60, y));
  const body = Bodies.rectangle(spawnX, spawnY, 30, 30, {
    density: 0.001,
    friction: 0.72,
    frictionAir: 0.018,
    restitution: 0.22,
    label: "pickup",
  });
  Body.setAngle(body, Math.random() * Math.PI * 2);
  if (options.velocity) Body.setVelocity(body, options.velocity);
  if (options.angularVelocity !== undefined) Body.setAngularVelocity(body, options.angularVelocity);
  World.add(engine.world, body);
  const pickup: Pickup = {
    id: `i${pickupSequence}`,
    item,
    body,
    protectedOwnerId: options.protectedOwnerId ?? null,
    ownerProtectionUntil: now + (options.ownerProtectionMs ?? 0),
    isWorld: options.isWorld ?? false,
  };
  pickups.set(pickup.id, pickup);
  return pickup;
}

function dropInventoryOnDeath(player: Player, now: number) {
  const carriedItems = player.inventory.filter((item): item is ItemId => item !== null);
  player.inventory.fill(null);
  player.selectedSlot = 0;
  for (let index = 0; index < carriedItems.length; index += 1) {
    const item = carriedItems[index];
    const angle = (index / Math.max(1, carriedItems.length)) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const pickup = spawnPickup(
      item,
      player.body.position.x + Math.cos(angle) * 26,
      player.body.position.y - 16,
      now,
      {
        velocity: {
          x: Math.cos(angle) * (4.2 + Math.random() * 3.6),
          y: -5.5 - Math.random() * 2.5,
        },
        angularVelocity: (Math.random() - 0.5) * 0.48,
      },
    );
    if (!pickup) player.pendingDrops.push(item);
  }
  syncInventory(player);
}

function flushPendingDrops(now: number) {
  for (const player of players.values()) {
    if (player.pendingDrops.length === 0) continue;
    const remaining: ItemId[] = [];
    for (const item of player.pendingDrops) {
      const pickup = spawnPickup(item, player.body.position.x, player.body.position.y - 30, now, {
        velocity: { x: (Math.random() - 0.5) * 5, y: -4.5 - Math.random() * 2 },
        angularVelocity: (Math.random() - 0.5) * 0.4,
      });
      if (!pickup) remaining.push(item);
    }
    player.pendingDrops = remaining;
  }
}

function spawnWorldLoot(now: number) {
  const worldPickupCount = [...pickups.values()].filter((pickup) => pickup.isWorld).length;
  if (worldPickupCount >= LOOT_SPAWNS.length) return;
  const cycleIndex = lootSequence % LOOT_SPAWNS.length;
  const zoneIndex = cycleIndex % ZONES.length;
  const tier = Math.floor(cycleIndex / ZONES.length);
  const lootPerZone = LOOT_SPAWNS.length / ZONES.length;
  const point = LOOT_SPAWNS[zoneIndex * lootPerZone + tier];
  const item = lootCycle[lootSequence % lootCycle.length];
  lootSequence += 1;
  spawnPickup(item, point.x, point.y, now, { isWorld: true });
}

function shootProjectile(player: Player, item: ItemId, now: number) {
  const weapon = ITEMS[item];
  const aim = normalizeAim(player.input);
  const pellets = weapon.projectiles ?? 1;
  const spread = weapon.spread ?? 0;
  const baseAngle = Math.atan2(aim.y, aim.x);
  const muzzleX = player.body.position.x + aim.x * 25;
  const muzzleY = player.body.position.y + aim.y * 7;
  io.emit("weaponSound", { ownerId: player.id, x: muzzleX, y: muzzleY, angle: baseAngle, item });
  const shotEvent: ShotEvent = { ownerId: player.id, x: muzzleX, y: muzzleY, angle: baseAngle, item };
  io.emit("shot", shotEvent);
  for (let index = 0; index < pellets; index += 1) {
    const factor = pellets === 1 ? 0 : index / (pellets - 1) - 0.5;
    const angle = baseAngle + factor * spread;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const body = Bodies.circle(
      player.body.position.x + direction.x * 25,
      player.body.position.y + direction.y * 7,
      weapon.projectileRadius ?? 5,
      { isSensor: true, frictionAir: 0, label: "bullet" },
    );
    Body.setVelocity(body, {
      x: direction.x * (weapon.projectileSpeed ?? 19),
      y: direction.y * (weapon.projectileSpeed ?? 19),
    });
    bulletSequence += 1;
    bullets.set(`b${bulletSequence}`, {
      id: `b${bulletSequence}`,
      item,
      ownerId: player.id,
      body,
      expiresAt: now + (weapon.projectileLifetime ?? 1250),
    });
    World.add(engine.world, body);
  }
  if (item !== "plasma") {
    const casingAngle = baseAngle - Math.PI / 2;
    const casing: CasingEvent = {
      x: muzzleX - aim.x * 4,
      y: muzzleY - aim.y * 4,
      vx: aim.x * 1.8 + Math.cos(casingAngle) * (2.2 + Math.random() * 1.8),
      vy: aim.y * 1.8 + Math.sin(casingAngle) * (2.2 + Math.random() * 1.8) - 2.2,
      angle: casingAngle,
      angularVelocity: (Math.random() - 0.5) * 0.55,
      item,
    };
    io.emit("casing", casing);
  }
}

function useSelectedItem(player: Player, now: number) {
  if (player.dead) return;
  const item = activeItem(player);
  if (!item) {
    notice(player, "当前栏位为空", now);
    return;
  }
  const weapon = ITEMS[item];
  if (now - player.cooldowns[item] < weapon.cooldown) return;

  if (weapon.kind === "melee") {
    io.emit("weaponSound", {
      ownerId: player.id,
      x: player.body.position.x,
      y: player.body.position.y,
      angle: Math.atan2(player.input.aimY, player.input.aimX),
      item,
    });
    player.cooldowns[item] = now;
    player.slashUntil = now + 155;
    player.swingHits.clear();
    return;
  }
  if (weapon.kind === "utility") {
    const restored = Math.min(weapon.heal ?? 0, WORLD.maxHealth - player.health);
    if (restored === 0) {
      notice(player, "生命值已满", now);
      return;
    }
    player.cooldowns[item] = now;
    player.health += restored;
    player.inventory[player.selectedSlot] = null;
    syncInventory(player);
    notice(player, `恢复生命 +${restored}`, now);
    return;
  }
  player.cooldowns[item] = now;
  shootProjectile(player, item, now);
}

function useLegacySword(player: Player, now: number) {
  const swordSlot = player.inventory.indexOf("sword");
  if (swordSlot === -1) return;
  const selectedSlot = player.selectedSlot;
  player.selectedSlot = swordSlot;
  useSelectedItem(player, now);
  player.selectedSlot = selectedSlot;
}

function dropSelectedItem(player: Player, now: number) {
  if (player.dead) return;
  const item = activeItem(player);
  if (!item) {
    notice(player, "没有可丢弃的物品", now);
    return;
  }
  const aim = normalizeAim(player.input);
  const pickup = spawnPickup(
    item,
    player.body.position.x + aim.x * 58,
    player.body.position.y + aim.y * 10 - 8,
    now,
    {
      protectedOwnerId: player.id,
      ownerProtectionMs: 700,
      velocity: {
        x: player.body.velocity.x * 0.45 + aim.x * 8.2,
        y: player.body.velocity.y * 0.25 + aim.y * 3.2 - 5.2,
      },
      angularVelocity: (Math.random() - 0.5) * 0.34,
    },
  );
  if (!pickup) {
    notice(player, `${ITEMS[item].label}箱子已达到场上上限`, now);
    return;
  }
  player.inventory[player.selectedSlot] = null;
  syncInventory(player);
  notice(player, `已丢弃 ${ITEMS[item].label}`, now);
}

function selectSlot(player: Player, slot: unknown) {
  if (!Number.isInteger(slot)) return;
  const value = Number(slot);
  if (value < 0 || value >= INVENTORY_SIZE || player.selectedSlot === value) return;
  player.selectedSlot = value;
  syncInventory(player);
}

function resolveSwordSwings(now: number) {
  for (const attacker of players.values()) {
    if (attacker.dead || attacker.slashUntil < now) continue;
    const aim = normalizeAim(attacker.input);
    const weapon = ITEMS.sword;
    for (const target of players.values()) {
      if (target.dead || target.id === attacker.id || attacker.swingHits.has(target.id)) continue;
      const dx = target.body.position.x - attacker.body.position.x;
      const dy = target.body.position.y - attacker.body.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance > (weapon.range ?? 80) || distance < 0.01) continue;
      const facing = (dx * aim.x + dy * aim.y) / distance;
      if (facing < 0.25) continue;
      attacker.swingHits.add(target.id);
      damage(target, attacker, weapon.damage ?? 0, now, "sword");
    }
  }
}

function resolveBullets(now: number) {
  for (const bullet of [...bullets.values()]) {
    if (bullet.expiresAt <= now || !Number.isFinite(bullet.body.position.x)) {
      removeBullet(bullet.id);
      continue;
    }
    if (Query.collides(bullet.body, solidTerrain).length > 0) {
      removeBullet(bullet.id, true);
      continue;
    }
    for (const target of players.values()) {
      if (target.dead || target.id === bullet.ownerId) continue;
      if (Query.collides(bullet.body, [target.body]).length === 0) continue;
      const attacker = players.get(bullet.ownerId);
      if (attacker) damage(target, attacker, ITEMS[bullet.item].damage ?? 0, now, bullet.item);
      removeBullet(bullet.id, true);
      break;
    }
  }
}

function resolvePickups(now: number) {
  for (const pickup of [...pickups.values()]) {
    for (const player of players.values()) {
      if (player.dead) continue;
      if (pickup.protectedOwnerId === player.id && pickup.ownerProtectionUntil > now) continue;
      if (Math.hypot(player.body.position.x - pickup.body.position.x, player.body.position.y - pickup.body.position.y) > 42) continue;
      const emptySlot = player.inventory.findIndex((slot) => slot === null);
      if (emptySlot === -1) {
        notice(player, "背包已满", now);
        continue;
      }
      player.inventory[emptySlot] = pickup.item;
      removePickup(pickup.id);
      syncInventory(player);
      notice(player, `已拾取 ${ITEMS[pickup.item].label}`, now);
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
      item: bullet.item,
      x: bullet.body.position.x,
      y: bullet.body.position.y,
    })),
    pickups: [...pickups.values()].map((pickup) => ({
      id: pickup.id,
      item: pickup.item,
      x: pickup.body.position.x,
      y: pickup.body.position.y,
      angle: pickup.body.angle,
    })),
    elevators: elevatorBodies.map((body, index) => ({
      id: ELEVATORS[index].id,
      x: body.position.x,
      y: body.position.y,
      width: ELEVATORS[index].width,
      height: ELEVATORS[index].height,
    })),
    killFeed: [...killFeed],
  };
}

createBot("ai-1", "AI·猎手 1", SPAWNS[2]);
createBot("ai-2", "AI·猎手 2", SPAWNS[9]);

for (let index = 0; index < Math.min(18, LOOT_SPAWNS.length); index += 1) spawnWorldLoot(Date.now());

io.on("connection", (socket) => {
  const spawn = getSpawn();
  playerSequence += 1;
  const player: Player = {
    id: socket.id,
    name: `玩家 ${playerSequence}`,
    body: Bodies.rectangle(spawn.x, spawn.y, WORLD.playerWidth, WORLD.playerHeight, {
      friction: 0,
      frictionAir: 0.04,
      restitution: 0,
      label: "player",
      inertia: Infinity,
    }),
    input: emptyInput(),
    inventory: [...STARTING_INVENTORY],
    selectedSlot: 0,
    cooldowns: emptyCooldowns(),
    health: WORLD.maxHealth,
    kills: 0,
    deaths: 0,
    dead: false,
    respawnAt: 0,
    invulnerableUntil: Date.now() + 3_000,
    pendingDrops: [],
    slashUntil: 0,
    swingHits: new Set(),
    lastNoticeAt: 0,
    lastChatAt: 0,
    isBot: false,
    bot: null,
  };
  players.set(socket.id, player);
  World.add(engine.world, player.body);
  socket.emit("welcome", { id: socket.id, name: player.name, inventory: inventoryState(player) });
  socket.emit("chatHistory", chatMessages);

  socket.on("input", (candidate: Partial<InputState>) => {
    if (typeof candidate.left === "boolean") player.input.left = candidate.left;
    if (typeof candidate.right === "boolean") player.input.right = candidate.right;
    if (candidate.jump === true) player.input.jump = true;
    if (Number.isFinite(candidate.aimX)) player.input.aimX = Number(candidate.aimX);
    if (Number.isFinite(candidate.aimY)) player.input.aimY = Number(candidate.aimY);
  });
  socket.on("use", () => useSelectedItem(player, Date.now()));
  socket.on("drop", () => dropSelectedItem(player, Date.now()));
  socket.on("selectSlot", (slot: unknown) => selectSlot(player, slot));
  socket.on("shoot", () => useSelectedItem(player, Date.now()));
  socket.on("slash", () => useLegacySword(player, Date.now()));
  socket.on("chat", (message: unknown) => sendChat(player, message, Date.now()));
  socket.on("setName", (candidate: unknown) => setPlayerName(player, candidate, Date.now()));
  socket.on("disconnect", () => {
    players.delete(socket.id);
    World.remove(engine.world, player.body);
  });
});

setInterval(() => {
  const now = Date.now();
  updateElevators(now);
  for (const player of players.values()) {
    if (player.dead && player.respawnAt <= now) respawn(player, now);
    if (player.isBot) updateBotAI(player, now);
    updatePlayerMovement(player);
  }
  Engine.update(engine, 1000 / 60);
  resolveSwordSwings(now);
  resolveBullets(now);
  resolvePickups(now);
  flushPendingDrops(now);
}, 1000 / 60);

setInterval(() => spawnWorldLoot(Date.now()), 3_500);

setInterval(() => {
  io.emit("snapshot", snapshot(Date.now()));
}, 1000 / 20);

app.get("/health", (_request, response) => {
  response.json({ ok: true, players: players.size, pickups: pickups.size });
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
