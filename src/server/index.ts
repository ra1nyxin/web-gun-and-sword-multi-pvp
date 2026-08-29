import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Matter from "matter-js";
import { Server } from "socket.io";
import {
  DEV_SOCKET_PORT,
  ChatMessage,
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

type BotBrain = {
  targetId: string | null;
  nextThinkAt: number;
  nextAttackAt: number;
  nextJumpAt: number;
  strafeDirection: number;
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

function findBotTarget(bot: Player) {
  return [...players.values()]
    .filter((candidate) => candidate.id !== bot.id && !candidate.dead)
    .sort((left, right) => {
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
    const velocity = bullet.body.velocity;
    const speedSquared = velocity.x * velocity.x + velocity.y * velocity.y;
    if (speedSquared < 0.01) continue;
    const offsetX = bot.body.position.x - bullet.body.position.x;
    const offsetY = bot.body.position.y - bullet.body.position.y;
    const projectedTime = Math.max(0, Math.min(12, (offsetX * velocity.x + offsetY * velocity.y) / speedSquared));
    const closestX = bullet.body.position.x + velocity.x * projectedTime;
    const closestY = bullet.body.position.y + velocity.y * projectedTime;
    const distance = Math.hypot(bot.body.position.x - closestX, bot.body.position.y - closestY);
    if (distance > 68 || distance >= closestDistance) continue;
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

function updateBotAI(bot: Player, now: number) {
  const brain = bot.bot;
  if (!brain || bot.dead) return;
  bot.input.jump = false;
  if (now >= brain.nextThinkAt || !brain.targetId || players.get(brain.targetId)?.dead) {
    brain.targetId = findBotTarget(bot)?.id ?? null;
    brain.nextThinkAt = now + 180 + Math.random() * 160;
    if (Math.random() < 0.35) brain.strafeDirection *= -1;
  }

  const target = brain.targetId ? players.get(brain.targetId) ?? null : null;
  const dodgeDirection = incomingBulletDodge(bot);
  let moveDirection = dodgeDirection ?? brain.strafeDirection;
  if (target) {
    const dx = target.body.position.x - bot.body.position.x;
    const dy = target.body.position.y - bot.body.position.y;
    const distance = Math.hypot(dx, dy);
    const prediction = Math.min(14, distance / 20);
    bot.input.aimX = target.body.position.x + target.body.velocity.x * prediction - bot.body.position.x;
    bot.input.aimY = target.body.position.y + target.body.velocity.y * prediction - bot.body.position.y;
    if (dodgeDirection === null) {
      if (distance > 125) moveDirection = Math.sign(dx) || brain.strafeDirection;
      else if (distance < 70) moveDirection = -Math.sign(dx) || brain.strafeDirection;
    }
    const weaponSlot = botWeaponSlot(bot, distance);
    if (weaponSlot >= 0) {
      bot.selectedSlot = weaponSlot;
      if (now >= brain.nextAttackAt) {
        useSelectedItem(bot, now);
        brain.nextAttackAt = now + 70 + Math.random() * 90;
      }
    }
    if (isGrounded(bot) && now >= brain.nextJumpAt && (dy < -58 || dodgeDirection !== null || Math.abs(dx) > 220)) {
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
  return [...pickups.values()].some((pickup) => {
    const pickupBounds = pickup.body.bounds;
    const overlapsX = bounds.max.x > pickupBounds.min.x + 4 && bounds.min.x < pickupBounds.max.x - 4;
    return overlapsX && feetY >= pickupBounds.min.y - 7 && feetY <= pickupBounds.min.y + 11 && player.body.velocity.y >= -1;
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
  target.health = Math.max(0, target.health - amount);
  if (target.health > 0) return;

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
    if (Query.collides(bullet.body, terrain).length > 0) {
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
    slashUntil: 0,
    swingHits: new Set(),
    lastNoticeAt: 0,
    lastChatAt: 0,
    isBot: false,
    bot: null,
  };
  players.set(socket.id, player);
  World.add(engine.world, player.body);
  socket.emit("welcome", { id: socket.id, inventory: inventoryState(player) });
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
  socket.on("disconnect", () => {
    players.delete(socket.id);
    World.remove(engine.world, player.body);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const player of players.values()) {
    if (player.dead && player.respawnAt <= now) respawn(player);
    if (player.isBot) updateBotAI(player, now);
    updatePlayerMovement(player);
  }
  Engine.update(engine, 1000 / 60);
  resolveSwordSwings(now);
  resolveBullets(now);
  resolvePickups(now);
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
