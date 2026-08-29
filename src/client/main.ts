import { io, Socket } from "socket.io-client";
import { INVENTORY_SIZE, ITEMS, LIGHTS, PLATFORMS, WORLD, ZONES } from "../shared/game";
import type { ChatMessage, ImpactEvent, InventorySlot, InventoryState, ItemId, PlayerState, Snapshot } from "../shared/game";
import "./style.css";

type RenderPlayer = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: PlayerState;
};

type BulletVisual = {
  item: ItemId;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  previousX: number;
  previousY: number;
};

type PickupVisual = {
  item: ItemId;
  x: number;
  y: number;
  angle: number;
  targetX: number;
  targetY: number;
  targetAngle: number;
};

type ImpactParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

type ImpactFlash = {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  color: string;
};

const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const context = canvas.getContext("2d")!;
const lightingCanvas = document.createElement("canvas");
lightingCanvas.width = VIEW_WIDTH;
lightingCanvas.height = VIEW_HEIGHT;
const lightingContext = lightingCanvas.getContext("2d")!;
const lightCanvas = document.createElement("canvas");
lightCanvas.width = VIEW_WIDTH;
lightCanvas.height = VIEW_HEIGHT;
const lightContext = lightCanvas.getContext("2d")!;
const socket: Socket = io({ transports: ["websocket", "polling"] });
const players = new Map<string, RenderPlayer>();
const bullets = new Map<string, BulletVisual>();
const pickupVisuals = new Map<string, PickupVisual>();
const keys = new Set<string>();
const slotButtons: HTMLButtonElement[] = [];
const impactParticles: ImpactParticle[] = [];
const impactFlashes: ImpactFlash[] = [];

const healthFill = document.querySelector<HTMLDivElement>("#health-fill")!;
const healthValue = document.querySelector<HTMLSpanElement>("#health-value")!;
const playerCount = document.querySelector<HTMLSpanElement>("#player-count")!;
const connection = document.querySelector<HTMLSpanElement>("#connection")!;
const respawn = document.querySelector<HTMLDivElement>("#respawn")!;
const activeItemCode = document.querySelector<HTMLSpanElement>("#active-item-code")!;
const activeItemName = document.querySelector<HTMLElement>("#active-item-name")!;
const weaponReady = document.querySelector<HTMLSpanElement>("#weapon-ready")!;
const kills = document.querySelector<HTMLSpanElement>("#kills")!;
const deaths = document.querySelector<HTMLSpanElement>("#deaths")!;
const killFeed = document.querySelector<HTMLOListElement>("#kill-feed")!;
const leaderboard = document.querySelector<HTMLOListElement>("#leaderboard")!;
const inventoryElement = document.querySelector<HTMLDivElement>("#inventory")!;
const noticeElement = document.querySelector<HTMLDivElement>("#notice")!;
const chatPanel = document.querySelector<HTMLElement>("#chat-panel")!;
const chatOpenButton = document.querySelector<HTMLButtonElement>("#chat-open")!;
const chatLog = document.querySelector<HTMLOListElement>("#chat-log")!;
const chatForm = document.querySelector<HTMLFormElement>("#chat-form")!;
const chatInput = document.querySelector<HTMLInputElement>("#chat-input")!;

let myId = "";
let latestSnapshot: Snapshot | null = null;
let inventory: InventoryState = {
  slots: Array<InventorySlot>(INVENTORY_SIZE).fill(null),
  selectedSlot: 0,
};
let cameraX = WORLD.width / 2;
let cameraY = WORLD.height / 2;
let aimScreenX = VIEW_WIDTH / 2;
let aimScreenY = VIEW_HEIGHT / 2;
let lastInputAt = 0;
let noticeTimeout = 0;
let killFeedKey = "";
let leaderboardKey = "";
let chatActive = false;
let chatMessages: ChatMessage[] = [];
let lastRenderAt = 0;

function applyInventory(next: InventoryState) {
  if (next.slots.length !== INVENTORY_SIZE) return;
  inventory = { slots: [...next.slots], selectedSlot: next.selectedSlot };
  renderInventory();
}

function showNotice(message: string) {
  noticeElement.textContent = message;
  noticeElement.hidden = false;
  window.clearTimeout(noticeTimeout);
  noticeTimeout = window.setTimeout(() => {
    noticeElement.hidden = true;
  }, 1_500);
}

function renderChat() {
  const shouldStickToBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 28;
  chatLog.replaceChildren();
  for (const message of chatMessages) {
    const row = document.createElement("li");
    const sender = document.createElement("strong");
    const text = document.createElement("span");
    sender.textContent = message.sender;
    text.textContent = message.text;
    row.append(sender, text);
    chatLog.append(row);
  }
  if (shouldStickToBottom) chatLog.scrollTop = chatLog.scrollHeight;
}

function receiveChat(message: ChatMessage) {
  if (chatMessages.some((entry) => entry.id === message.id)) return;
  chatMessages = [...chatMessages, message].slice(-60);
  renderChat();
}

function openChat() {
  if (chatActive || !myId) return;
  chatActive = true;
  keys.clear();
  chatPanel.classList.add("is-composing");
  chatForm.hidden = false;
  chatInput.value = "";
  chatInput.focus();
}

function closeChat() {
  if (!chatActive) return;
  chatActive = false;
  chatPanel.classList.remove("is-composing");
  chatForm.hidden = true;
  chatInput.value = "";
  chatInput.blur();
}

function sendChat() {
  const text = chatInput.value.trim();
  if (text) socket.emit("chat", text);
  closeChat();
}

function createInventory() {
  for (let index = 0; index < INVENTORY_SIZE; index += 1) {
    const button = document.createElement("button");
    button.className = "inventory-slot";
    button.type = "button";
    button.addEventListener("click", () => selectSlot(index));

    const number = document.createElement("span");
    number.className = "slot-number";
    number.textContent = String(index + 1);
    const code = document.createElement("span");
    code.className = "slot-code";
    const name = document.createElement("span");
    name.className = "slot-name";

    button.append(number, code, name);
    inventoryElement.append(button);
    slotButtons.push(button);
  }
  renderInventory();
}

function renderInventory() {
  for (let index = 0; index < INVENTORY_SIZE; index += 1) {
    const button = slotButtons[index];
    const item = inventory.slots[index];
    const code = button.querySelector<HTMLSpanElement>(".slot-code")!;
    const name = button.querySelector<HTMLSpanElement>(".slot-name")!;
    button.classList.toggle("selected", inventory.selectedSlot === index);
    button.classList.toggle("empty", item === null);
    if (!item) {
      code.textContent = "--";
      name.textContent = "";
      button.style.removeProperty("--item-color");
      button.title = `栏位 ${index + 1}: 空`;
      continue;
    }
    const definition = ITEMS[item];
    code.textContent = definition.code;
    name.textContent = definition.label;
    button.style.setProperty("--item-color", definition.color);
    button.title = `栏位 ${index + 1}: ${definition.label}`;
  }
}

function selectSlot(slot: number) {
  if (slot < 0 || slot >= INVENTORY_SIZE) return;
  inventory = { ...inventory, selectedSlot: slot };
  renderInventory();
  socket.emit("selectSlot", slot);
}

function updateKillFeed(snapshot: Snapshot) {
  const nextKey = snapshot.killFeed.map((entry) => entry.id).join(",");
  if (nextKey === killFeedKey) return;
  killFeedKey = nextKey;
  killFeed.replaceChildren();
  for (const entry of snapshot.killFeed) {
    const row = document.createElement("li");
    const weapon = ITEMS[entry.item];
    row.textContent = `${entry.attacker} 使用${weapon.label}击败 ${entry.victim}`;
    row.style.setProperty("--weapon-color", weapon.color);
    killFeed.append(row);
  }
}

function updateLeaderboard(snapshot: Snapshot) {
  const sorted = [...snapshot.players].sort((left, right) => right.kills - left.kills || left.deaths - right.deaths);
  const nextKey = sorted.map((player) => `${player.id}:${player.kills}:${player.deaths}`).join(",");
  if (nextKey === leaderboardKey) return;
  leaderboardKey = nextKey;
  leaderboard.replaceChildren();
  for (const player of sorted.slice(0, 6)) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    const score = document.createElement("span");
    name.textContent = player.id === myId ? "你" : player.name;
    score.textContent = `胜${player.kills} 负${player.deaths}`;
    row.append(name, score);
    leaderboard.append(row);
  }
}

function updateHud() {
  if (!latestSnapshot) return;
  const mine = latestSnapshot.players.find((player) => player.id === myId);
  playerCount.textContent = String(latestSnapshot.players.length);
  if (!mine) return;
  healthFill.style.width = `${mine.health}%`;
  healthValue.textContent = String(mine.health);
  kills.textContent = `击败 ${mine.kills}`;
  deaths.textContent = `倒下 ${mine.deaths}`;
  respawn.hidden = !mine.dead;
  const item = mine.activeItem;
  if (!item) {
    activeItemCode.textContent = "--";
    activeItemName.textContent = "空栏";
    weaponReady.textContent = "";
    activeItemCode.style.removeProperty("--item-color");
    return;
  }
  const weapon = ITEMS[item];
  activeItemCode.textContent = weapon.code;
  activeItemName.textContent = weapon.label;
  activeItemCode.style.setProperty("--item-color", weapon.color);
  weaponReady.textContent = mine.weaponReadyIn > 0 ? `${(mine.weaponReadyIn / 1000).toFixed(1)} 秒` : "就绪";
}

function rgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function spawnImpact(x: number, y: number, item: ItemId) {
  const color = ITEMS[item].color;
  const maxLife = item === "plasma" ? 360 : 250;
  impactFlashes.push({ x, y, color, life: maxLife, maxLife });
  for (let index = 0; index < 13; index += 1) {
    const angle = (Math.PI * 2 * index) / 13 + (Math.random() - 0.5) * 0.42;
    const life = 210 + Math.random() * 330;
    const speed = 0.1 + Math.random() * 0.19;
    impactParticles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.04,
      life,
      maxLife: life,
      color,
      size: 1.5 + Math.random() * 3.4,
    });
  }
  impactParticles.splice(0, Math.max(0, impactParticles.length - 360));
  impactFlashes.splice(0, Math.max(0, impactFlashes.length - 24));
}

function syncBullets(snapshot: Snapshot) {
  const activeIds = new Set<string>();
  for (const bullet of snapshot.bullets) {
    activeIds.add(bullet.id);
    const visual = bullets.get(bullet.id);
    if (visual) {
      visual.targetX = bullet.x;
      visual.targetY = bullet.y;
      continue;
    }
    bullets.set(bullet.id, {
      item: bullet.item,
      x: bullet.x,
      y: bullet.y,
      targetX: bullet.x,
      targetY: bullet.y,
      previousX: bullet.x,
      previousY: bullet.y,
    });
  }
  for (const [id, visual] of bullets) {
    if (activeIds.has(id)) continue;
    bullets.delete(id);
  }
}

function syncPickups(snapshot: Snapshot) {
  const activeIds = new Set<string>();
  for (const pickup of snapshot.pickups) {
    activeIds.add(pickup.id);
    const visual = pickupVisuals.get(pickup.id);
    if (visual) {
      visual.item = pickup.item;
      visual.targetX = pickup.x;
      visual.targetY = pickup.y;
      visual.targetAngle = pickup.angle;
      continue;
    }
    pickupVisuals.set(pickup.id, {
      item: pickup.item,
      x: pickup.x,
      y: pickup.y,
      angle: pickup.angle,
      targetX: pickup.x,
      targetY: pickup.y,
      targetAngle: pickup.angle,
    });
  }
  for (const id of pickupVisuals.keys()) {
    if (!activeIds.has(id)) pickupVisuals.delete(id);
  }
}

function approachAngle(current: number, target: number, amount: number) {
  let delta = target - current;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  return current + delta * amount;
}

function updateVisualEffects(now: number) {
  const delta = lastRenderAt === 0 ? 16 : Math.min(40, Math.max(1, now - lastRenderAt));
  lastRenderAt = now;
  for (const visual of bullets.values()) {
    visual.previousX = visual.x;
    visual.previousY = visual.y;
    visual.x += (visual.targetX - visual.x) * 0.52;
    visual.y += (visual.targetY - visual.y) * 0.52;
  }
  for (const pickup of pickupVisuals.values()) {
    pickup.x += (pickup.targetX - pickup.x) * 0.48;
    pickup.y += (pickup.targetY - pickup.y) * 0.48;
    pickup.angle = approachAngle(pickup.angle, pickup.targetAngle, 0.5);
  }
  for (let index = impactParticles.length - 1; index >= 0; index -= 1) {
    const particle = impactParticles[index];
    particle.x += particle.vx * delta;
    particle.vy += 0.0009 * delta;
    particle.y += particle.vy * delta;
    particle.life -= delta;
    if (particle.life <= 0) impactParticles.splice(index, 1);
  }
  for (let index = impactFlashes.length - 1; index >= 0; index -= 1) {
    const flash = impactFlashes[index];
    flash.life -= delta;
    if (flash.life <= 0) impactFlashes.splice(index, 1);
  }
}

socket.on("welcome", ({ id, inventory: nextInventory }: { id: string; inventory: InventoryState }) => {
  myId = id;
  applyInventory(nextInventory);
  connection.textContent = "在线";
});

socket.on("inventory", (nextInventory: InventoryState) => applyInventory(nextInventory));
socket.on("notice", ({ message }: { message: string }) => showNotice(message));
socket.on("impact", (impact: ImpactEvent) => {
  bullets.delete(impact.bulletId);
  spawnImpact(impact.x, impact.y, impact.item);
});
socket.on("chatHistory", (history: ChatMessage[]) => {
  chatMessages = history.slice(-60);
  renderChat();
  chatLog.scrollTop = chatLog.scrollHeight;
});
socket.on("chat", (message: ChatMessage) => receiveChat(message));
socket.on("snapshot", (snapshot: Snapshot) => {
  latestSnapshot = snapshot;
  const activeIds = new Set<string>();
  for (const state of snapshot.players) {
    activeIds.add(state.id);
    const existing = players.get(state.id);
    if (existing) {
      existing.targetX = state.x;
      existing.targetY = state.y;
      existing.state = state;
      continue;
    }
    players.set(state.id, {
      x: state.x,
      y: state.y,
      targetX: state.x,
      targetY: state.y,
      state,
    });
  }
  for (const id of players.keys()) {
    if (!activeIds.has(id)) players.delete(id);
  }
  syncBullets(snapshot);
  syncPickups(snapshot);
  updateHud();
  updateKillFeed(snapshot);
  updateLeaderboard(snapshot);
});

socket.on("disconnect", () => {
  closeChat();
  connection.textContent = "重连中";
});

function worldPointFromEvent(event: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  aimScreenX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
  aimScreenY = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT;
}

window.addEventListener("keydown", (event) => {
  if (chatActive) {
    if (event.code === "Escape") {
      event.preventDefault();
      closeChat();
    }
    return;
  }
  if (event.code === "KeyT" && !event.repeat) {
    event.preventDefault();
    openChat();
    return;
  }
  keys.add(event.code);
  if (event.code === "KeyQ" && !event.repeat) socket.emit("drop");
  const slotMatch = event.code.match(/^(Digit|Numpad)([1-9])$/);
  if (slotMatch && !event.repeat) selectSlot(Number(slotMatch[2]) - 1);
  if (["ArrowUp", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
});
window.addEventListener("keyup", (event) => {
  if (!chatActive) keys.delete(event.code);
});
window.addEventListener("blur", () => keys.clear());
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat();
});
chatInput.addEventListener("keydown", (event) => {
  event.stopPropagation();
  if (event.code === "Escape") {
    event.preventDefault();
    closeChat();
    return;
  }
  if (event.code === "Enter" && !event.isComposing) {
    event.preventDefault();
    sendChat();
  }
});
chatOpenButton.addEventListener("click", openChat);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("mousedown", (event) => {
  worldPointFromEvent(event);
  if (event.button === 0) socket.emit("use");
});
canvas.addEventListener("mousemove", worldPointFromEvent);
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    if (direction === 0) return;
    selectSlot((inventory.selectedSlot + direction + INVENTORY_SIZE) % INVENTORY_SIZE);
  },
  { passive: false },
);

function sendInput(now: number) {
  if (!myId || now - lastInputAt < 33) return;
  const mine = players.get(myId);
  if (!mine) return;
  const worldX = cameraX - VIEW_WIDTH / 2 + aimScreenX;
  const worldY = cameraY - VIEW_HEIGHT / 2 + aimScreenY;
  socket.emit("input", {
    left: keys.has("KeyA") || keys.has("ArrowLeft"),
    right: keys.has("KeyD") || keys.has("ArrowRight"),
    jump: keys.has("KeyW") || keys.has("ArrowUp") || keys.has("Space"),
    aimX: worldX - mine.x,
    aimY: worldY - mine.y,
  });
  lastInputAt = now;
}

function clampCamera() {
  cameraX = Math.max(VIEW_WIDTH / 2, Math.min(WORLD.width - VIEW_WIDTH / 2, cameraX));
  cameraY = Math.max(VIEW_HEIGHT / 2, Math.min(WORLD.height - VIEW_HEIGHT / 2, cameraY));
}

function drawArena() {
  context.fillStyle = "#101820";
  context.fillRect(0, 0, WORLD.width, WORLD.height);
  for (const zone of ZONES) {
    context.fillStyle = zone.color;
    context.fillRect(zone.x, zone.y, zone.width, zone.height);
    context.strokeStyle = zone.gridColor;
    context.lineWidth = 2;
    context.strokeRect(zone.x, zone.y, zone.width, zone.height);
    context.fillStyle = "rgba(233, 242, 231, 0.18)";
    context.font = "600 28px 'Microsoft YaHei', Arial, sans-serif";
    context.textAlign = "left";
    context.fillText(zone.name, zone.x + 34, 64);
  }
  context.strokeStyle = "rgba(233, 242, 231, 0.1)";
  context.lineWidth = 1;
  for (let x = 0; x <= WORLD.width; x += 80) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, WORLD.height);
    context.stroke();
  }
  for (let y = 0; y <= WORLD.height; y += 80) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WORLD.width, y);
    context.stroke();
  }
  for (const platform of PLATFORMS) {
    const zone = ZONES.find((entry) => platform.x >= entry.x && platform.x < entry.x + entry.width);
    const left = platform.x - platform.width / 2;
    const top = platform.y - platform.height / 2;
    context.fillStyle = "#283f3d";
    context.fillRect(left, top, platform.width, platform.height);
    context.fillStyle = zone?.accent ?? "#d6ad60";
    context.fillRect(left, top, platform.width, 5);
    context.strokeStyle = "#0b1217";
    context.lineWidth = 2;
    context.strokeRect(left, top, platform.width, platform.height);
  }
}

function drawLightFixtures() {
  context.save();
  for (const light of LIGHTS) {
    context.strokeStyle = "#090f14";
    context.fillStyle = "#1c2830";
    context.lineWidth = 3;
    if (light.kind === "lamp") {
      context.beginPath();
      context.moveTo(light.x, light.y + 4);
      context.lineTo(light.x, light.y + 52);
      context.stroke();
      context.fillRect(light.x - 10, light.y - 30, 20, 10);
      context.strokeRect(light.x - 10, light.y - 30, 20, 10);
    } else {
      context.save();
      context.translate(light.x, light.y);
      context.rotate(light.angle ?? Math.PI / 2);
      context.fillRect(-12, -7, 25, 14);
      context.strokeRect(-12, -7, 25, 14);
      context.fillStyle = light.color;
      context.fillRect(10, -4, 5, 8);
      context.restore();
    }
    context.fillStyle = light.color;
    context.beginPath();
    context.arc(light.x, light.y, light.kind === "lamp" ? 4 : 5, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

type LightOccluder = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function normalizeAngle(angle: number) {
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function drawShadowPolygon(
  target: CanvasRenderingContext2D,
  sourceX: number,
  sourceY: number,
  lightRadius: number,
  occluder: LightOccluder,
) {
  if (sourceX >= occluder.left && sourceX <= occluder.right && sourceY >= occluder.top && sourceY <= occluder.bottom) {
    return;
  }
  const centerX = (occluder.left + occluder.right) / 2;
  const centerY = (occluder.top + occluder.bottom) / 2;
  const halfDiagonal = Math.hypot(occluder.right - centerX, occluder.bottom - centerY);
  if (Math.hypot(centerX - sourceX, centerY - sourceY) - halfDiagonal > lightRadius) return;

  const corners = [
    { x: occluder.left, y: occluder.top },
    { x: occluder.right, y: occluder.top },
    { x: occluder.right, y: occluder.bottom },
    { x: occluder.left, y: occluder.bottom },
  ];
  const centerAngle = Math.atan2(centerY - sourceY, centerX - sourceX);
  const deltas = corners.map((corner) => normalizeAngle(Math.atan2(corner.y - sourceY, corner.x - sourceX) - centerAngle));
  let minIndex = 0;
  let maxIndex = 0;
  for (let index = 1; index < deltas.length; index += 1) {
    if (deltas[index] < deltas[minIndex]) minIndex = index;
    if (deltas[index] > deltas[maxIndex]) maxIndex = index;
  }
  const minDelta = deltas[minIndex];
  const maxDelta = deltas[maxIndex];
  if (maxDelta - minDelta > Math.PI * 0.98) return;

  const directionX = centerX - sourceX;
  const directionY = centerY - sourceY;
  const farCornerIndexes = corners
    .map((corner, index) => ({
      index,
      projection: (corner.x - centerX) * directionX + (corner.y - centerY) * directionY,
    }))
    .sort((left, right) => right.projection - left.projection)
    .slice(0, 2)
    .map((entry) => entry.index)
    .sort((left, right) => deltas[left] - deltas[right]);

  const distance = Math.max(lightRadius * 2.2, Math.hypot(VIEW_WIDTH, VIEW_HEIGHT) * 2);
  const farMin = {
    x: sourceX + Math.cos(centerAngle + minDelta) * distance,
    y: sourceY + Math.sin(centerAngle + minDelta) * distance,
  };
  const farMax = {
    x: sourceX + Math.cos(centerAngle + maxDelta) * distance,
    y: sourceY + Math.sin(centerAngle + maxDelta) * distance,
  };
  const shadowStartA = corners[farCornerIndexes[0]];
  const shadowStartB = corners[farCornerIndexes[1]];
  target.beginPath();
  target.moveTo(shadowStartA.x, shadowStartA.y);
  target.lineTo(shadowStartB.x, shadowStartB.y);
  target.lineTo(farMax.x, farMax.y);
  target.lineTo(farMin.x, farMin.y);
  target.closePath();
  target.fill();
}

function drawLighting() {
  const left = cameraX - VIEW_WIDTH / 2;
  const top = cameraY - VIEW_HEIGHT / 2;

  context.save();
  context.fillStyle = "rgba(2, 5, 9, 0.56)";
  context.fillRect(left, top, VIEW_WIDTH, VIEW_HEIGHT);

  lightingContext.setTransform(1, 0, 0, 1, 0, 0);
  lightingContext.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  for (const light of LIGHTS) {
    if (light.x + light.radius < left || light.x - light.radius > left + VIEW_WIDTH) continue;
    if (light.y + light.radius < top || light.y - light.radius > top + VIEW_HEIGHT) continue;

    const sourceX = light.x - left;
    const sourceY = light.y - top;
    lightContext.setTransform(1, 0, 0, 1, 0, 0);
    lightContext.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    lightContext.globalCompositeOperation = "source-over";
    const gradient = lightContext.createRadialGradient(sourceX, sourceY, 0, sourceX, sourceY, light.radius);
    gradient.addColorStop(0, rgba(light.color, 0.38));
    gradient.addColorStop(0.32, rgba(light.color, 0.18));
    gradient.addColorStop(1, rgba(light.color, 0));
    lightContext.save();
    if (light.kind === "spot") {
      const angle = light.angle ?? Math.PI / 2;
      const spread = light.spread ?? 0.4;
      lightContext.beginPath();
      lightContext.moveTo(sourceX, sourceY);
      lightContext.lineTo(
        sourceX + Math.cos(angle - spread) * light.radius,
        sourceY + Math.sin(angle - spread) * light.radius,
      );
      lightContext.lineTo(
        sourceX + Math.cos(angle + spread) * light.radius,
        sourceY + Math.sin(angle + spread) * light.radius,
      );
      lightContext.closePath();
      lightContext.clip();
    }
    lightContext.fillStyle = gradient;
    lightContext.fillRect(sourceX - light.radius, sourceY - light.radius, light.radius * 2, light.radius * 2);
    lightContext.restore();

    lightContext.globalCompositeOperation = "destination-out";
    lightContext.fillStyle = "rgba(0, 0, 0, 1)";
    for (const platform of PLATFORMS) {
      const platformLeft = platform.x - platform.width / 2 - left;
      const platformTop = platform.y - platform.height / 2 - top;
      drawShadowPolygon(lightContext, sourceX, sourceY, light.radius, {
        left: platformLeft,
        right: platformLeft + platform.width,
        top: platformTop,
        bottom: platformTop + platform.height,
      });
    }
    for (const player of players.values()) {
      if (player.state.dead) continue;
      drawShadowPolygon(lightContext, sourceX, sourceY, light.radius, {
        left: player.x - 20 - left,
        right: player.x + 20 - left,
        top: player.y - 36 - top,
        bottom: player.y + 22 - top,
      });
    }
    lightingContext.globalCompositeOperation = "lighter";
    lightingContext.drawImage(lightCanvas, 0, 0);
  }

  context.globalCompositeOperation = "lighter";
  context.drawImage(lightingCanvas, left, top);
  context.restore();
}

function drawBullets() {
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  for (const bullet of bullets.values()) {
    const definition = ITEMS[bullet.item];
    const radius = bullet.item === "plasma" ? 9 : 4;
    const dx = bullet.x - bullet.previousX;
    const dy = bullet.y - bullet.previousY;
    const gradient = context.createRadialGradient(bullet.x, bullet.y, 0, bullet.x, bullet.y, radius * 5);
    gradient.addColorStop(0, rgba(definition.accent, 0.95));
    gradient.addColorStop(0.24, rgba(definition.color, 0.78));
    gradient.addColorStop(1, rgba(definition.color, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(bullet.x, bullet.y, radius * 5, 0, Math.PI * 2);
    context.fill();
    if (Math.hypot(dx, dy) > 0.2) {
      context.strokeStyle = rgba(definition.color, 0.62);
      context.lineWidth = radius * 1.35;
      context.beginPath();
      context.moveTo(bullet.x, bullet.y);
      context.lineTo(bullet.x - dx * 5, bullet.y - dy * 5);
      context.stroke();
    }
    context.fillStyle = definition.accent;
    context.beginPath();
    context.arc(bullet.x, bullet.y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawImpactEffects() {
  context.save();
  context.globalCompositeOperation = "lighter";
  for (const flash of impactFlashes) {
    const progress = flash.life / flash.maxLife;
    const radius = 24 + (1 - progress) * 52;
    const gradient = context.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, radius);
    gradient.addColorStop(0, rgba("#ffffff", progress * 0.82));
    gradient.addColorStop(0.25, rgba(flash.color, progress * 0.58));
    gradient.addColorStop(1, rgba(flash.color, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(flash.x, flash.y, radius, 0, Math.PI * 2);
    context.fill();
  }
  for (const particle of impactParticles) {
    const alpha = particle.life / particle.maxLife;
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(Math.atan2(particle.vy, particle.vx));
    context.fillStyle = rgba(particle.color, alpha * 0.88);
    context.fillRect(-particle.size * 1.4, -particle.size / 2, particle.size * 2.8, particle.size);
    context.restore();
  }
  context.restore();
}

function drawHeldItem(state: PlayerState) {
  if (!state.activeItem) return;
  const weapon = ITEMS[state.activeItem];
  const angle = Math.atan2(state.aimY, state.aimX);
  if (weapon.kind === "melee") {
    context.strokeStyle = weapon.accent;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(2, 2);
    context.lineTo(Math.cos(angle) * 35, Math.sin(angle) * 35 + 2);
    context.stroke();
    context.strokeStyle = weapon.color;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(2, 9);
    context.lineTo(Math.cos(angle + Math.PI / 2) * 12, Math.sin(angle + Math.PI / 2) * 12 + 9);
    context.stroke();
    return;
  }
  if (weapon.kind === "utility") {
    context.fillStyle = weapon.color;
    context.fillRect(-5, -5, 14, 14);
    context.fillStyle = weapon.accent;
    context.fillRect(0, -3, 4, 10);
    context.fillRect(-3, 0, 10, 4);
    return;
  }
  const length = state.activeItem === "rifle" ? 33 : state.activeItem === "scattergun" ? 25 : 28;
  context.strokeStyle = weapon.color;
  context.lineWidth = state.activeItem === "scattergun" ? 7 : 5;
  context.beginPath();
  context.moveTo(2, -4);
  context.lineTo(Math.cos(angle) * length, Math.sin(angle) * length - 4);
  context.stroke();
  context.strokeStyle = weapon.accent;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(Math.cos(angle) * (length - 8), Math.sin(angle) * (length - 8) - 4);
  context.lineTo(Math.cos(angle) * length, Math.sin(angle) * length - 4);
  context.stroke();
}

function drawPlayer(player: RenderPlayer, isLocal: boolean) {
  const { state, x, y } = player;
  const bodyColor = isLocal ? "#46c5d6" : "#ed6a5a";
  context.save();
  context.globalAlpha = state.dead ? 0.22 : 1;
  context.translate(x, y);
  context.fillStyle = bodyColor;
  context.strokeStyle = "#0b1217";
  context.lineWidth = 4;
  roundedRect(-16, -18, 32, 39, 5);
  context.fill();
  context.stroke();
  context.fillStyle = "#e9f2e7";
  context.beginPath();
  context.arc(0, -24, 11, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  drawHeldItem(state);
  if (state.slashUntil > 0) {
    const angle = Math.atan2(state.aimY, state.aimX);
    context.strokeStyle = "#ffd166";
    context.lineWidth = 4;
    context.beginPath();
    context.arc(0, 0, 52, angle - 0.85, angle + 0.85);
    context.stroke();
  }
  context.fillStyle = "#0b1217";
  context.fillRect(-19, -43, 38, 5);
  context.fillStyle = state.health > 35 ? "#76c893" : "#ed6a5a";
  context.fillRect(-18, -42, 36 * (state.health / WORLD.maxHealth), 3);
  context.restore();
  context.fillStyle = "#e9f2e7";
  context.font = "12px Arial, sans-serif";
  context.textAlign = "center";
  context.strokeStyle = "#0b1217";
  context.lineWidth = 3;
  const name = isLocal ? "你" : state.name;
  context.strokeText(name, x, y - 49);
  context.fillText(name, x, y - 49);
}

function drawPickup(item: InventorySlot, x: number, y: number, angle: number) {
  if (!item) return;
  const definition = ITEMS[item];
  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.32)";
  context.beginPath();
  context.ellipse(x, y + 19, 19, 5, 0, 0, Math.PI * 2);
  context.fill();
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = "rgba(11, 18, 23, 0.75)";
  context.fillRect(-16, -16, 32, 32);
  context.strokeStyle = definition.color;
  context.lineWidth = 2.5;
  context.strokeRect(-16, -16, 32, 32);
  context.fillStyle = rgba(definition.color, 0.76);
  context.fillRect(-12, -12, 24, 24);
  context.strokeStyle = rgba(definition.accent, 0.9);
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-12, -4);
  context.lineTo(12, -4);
  context.moveTo(-12, 4);
  context.lineTo(12, 4);
  context.stroke();
  context.fillStyle = "#101820";
  context.font = "bold 11px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(definition.code, 0, 1);
  context.restore();
}

function roundedRect(x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawReticle() {
  const mine = players.get(myId);
  if (!mine || mine.state.dead) return;
  const item = mine.state.activeItem;
  context.strokeStyle = item ? ITEMS[item].accent : "rgba(233, 242, 231, 0.8)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(aimScreenX, aimScreenY, 9, 0, Math.PI * 2);
  context.moveTo(aimScreenX - 14, aimScreenY);
  context.lineTo(aimScreenX + 14, aimScreenY);
  context.moveTo(aimScreenX, aimScreenY - 14);
  context.lineTo(aimScreenX, aimScreenY + 14);
  context.stroke();
}

function render(now: number) {
  updateVisualEffects(now);
  for (const player of players.values()) {
    player.x += (player.targetX - player.x) * 0.34;
    player.y += (player.targetY - player.y) * 0.34;
  }
  const mine = players.get(myId);
  if (mine) {
    cameraX += (mine.x - cameraX) * 0.16;
    cameraY += (mine.y - cameraY) * 0.16;
    clampCamera();
  }
  context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  context.save();
  context.translate(VIEW_WIDTH / 2 - cameraX, VIEW_HEIGHT / 2 - cameraY);
  drawArena();
  drawLightFixtures();
  for (const pickup of pickupVisuals.values()) drawPickup(pickup.item, pickup.x, pickup.y, pickup.angle);
  for (const [id, player] of players) drawPlayer(player, id === myId);
  drawLighting();
  drawBullets();
  drawImpactEffects();
  context.restore();
  drawReticle();
  sendInput(now);
  requestAnimationFrame(render);
}

createInventory();
requestAnimationFrame(render);
