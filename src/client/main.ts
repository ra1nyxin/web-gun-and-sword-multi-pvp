import { io, Socket } from "socket.io-client";
import { INVENTORY_SIZE, ITEMS, PLATFORMS, WORLD } from "../shared/game";
import type { ChatMessage, InventorySlot, InventoryState, PlayerState, Snapshot } from "../shared/game";
import "./style.css";

type RenderPlayer = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: PlayerState;
};

const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const context = canvas.getContext("2d")!;
const socket: Socket = io({ transports: ["websocket", "polling"] });
const players = new Map<string, RenderPlayer>();
const keys = new Set<string>();
const slotButtons: HTMLButtonElement[] = [];

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
  chatLog.replaceChildren();
  for (const message of chatMessages.slice(-6)) {
    const row = document.createElement("li");
    const sender = document.createElement("strong");
    const text = document.createElement("span");
    sender.textContent = message.sender;
    text.textContent = message.text;
    row.append(sender, text);
    chatLog.append(row);
  }
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

socket.on("welcome", ({ id, inventory: nextInventory }: { id: string; inventory: InventoryState }) => {
  myId = id;
  applyInventory(nextInventory);
  connection.textContent = "在线";
});

socket.on("inventory", (nextInventory: InventoryState) => applyInventory(nextInventory));
socket.on("notice", ({ message }: { message: string }) => showNotice(message));
socket.on("chatHistory", (history: ChatMessage[]) => {
  chatMessages = history.slice(-60);
  renderChat();
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
  context.fillStyle = "#17252f";
  context.fillRect(0, 0, WORLD.width, WORLD.height);
  context.strokeStyle = "#213640";
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
    const left = platform.x - platform.width / 2;
    const top = platform.y - platform.height / 2;
    context.fillStyle = "#283f3d";
    context.fillRect(left, top, platform.width, platform.height);
    context.fillStyle = "#d6ad60";
    context.fillRect(left, top, platform.width, 5);
    context.strokeStyle = "#0b1217";
    context.lineWidth = 2;
    context.strokeRect(left, top, platform.width, platform.height);
  }
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

function drawPickup(item: InventorySlot, x: number, y: number) {
  if (!item) return;
  const definition = ITEMS[item];
  context.save();
  context.translate(x, y);
  context.fillStyle = "rgba(11, 18, 23, 0.75)";
  context.fillRect(-17, -17, 34, 34);
  context.strokeStyle = definition.color;
  context.lineWidth = 2;
  context.strokeRect(-17, -17, 34, 34);
  context.fillStyle = definition.color;
  context.fillRect(-11, -11, 22, 22);
  context.fillStyle = "#101820";
  context.font = "bold 10px Arial, sans-serif";
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
  if (latestSnapshot) {
    for (const pickup of latestSnapshot.pickups) drawPickup(pickup.item, pickup.x, pickup.y);
    for (const bullet of latestSnapshot.bullets) {
      context.fillStyle = ITEMS[bullet.item].color;
      context.beginPath();
      context.arc(bullet.x, bullet.y, bullet.item === "plasma" ? 8 : 4, 0, Math.PI * 2);
      context.fill();
    }
  }
  for (const [id, player] of players) drawPlayer(player, id === myId);
  context.restore();
  drawReticle();
  sendInput(now);
  requestAnimationFrame(render);
}

createInventory();
requestAnimationFrame(render);
