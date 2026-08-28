import { io, Socket } from "socket.io-client";
import { PLATFORMS, PlayerState, Snapshot, WORLD } from "../shared/game";
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

const healthFill = document.querySelector<HTMLDivElement>("#health-fill")!;
const healthValue = document.querySelector<HTMLSpanElement>("#health-value")!;
const playerCount = document.querySelector<HTMLSpanElement>("#player-count")!;
const connection = document.querySelector<HTMLSpanElement>("#connection")!;
const respawn = document.querySelector<HTMLDivElement>("#respawn")!;

let myId = "";
let latestSnapshot: Snapshot | null = null;
let cameraX = WORLD.width / 2;
let cameraY = WORLD.height / 2;
let aimScreenX = VIEW_WIDTH / 2;
let aimScreenY = VIEW_HEIGHT / 2;
let lastInputAt = 0;

socket.on("welcome", ({ id }: { id: string }) => {
  myId = id;
  connection.textContent = "ONLINE";
});

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
});

socket.on("disconnect", () => {
  connection.textContent = "RECONNECTING";
});

function updateHud() {
  if (!latestSnapshot) return;
  const mine = latestSnapshot.players.find((player) => player.id === myId);
  playerCount.textContent = String(latestSnapshot.players.length);
  if (!mine) return;
  healthFill.style.width = `${mine.health}%`;
  healthValue.textContent = String(mine.health);
  respawn.hidden = !mine.dead;
}

function worldPointFromEvent(event: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  aimScreenX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
  aimScreenY = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT;
  return {
    x: cameraX - VIEW_WIDTH / 2 + aimScreenX,
    y: cameraY - VIEW_HEIGHT / 2 + aimScreenY,
  };
}

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "KeyQ" && !event.repeat) socket.emit("slash");
  if (["ArrowUp", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("mousedown", (event) => {
  worldPointFromEvent(event);
  if (event.button === 2) socket.emit("slash");
  if (event.button === 0) socket.emit("shoot");
});
canvas.addEventListener("mousemove", worldPointFromEvent);

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
  context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  context.strokeStyle = "#213640";
  context.lineWidth = 1;
  for (let x = -80; x <= WORLD.width; x += 80) {
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

function drawPlayer(player: RenderPlayer, isLocal: boolean) {
  const { state, x, y } = player;
  const angle = Math.atan2(state.aimY, state.aimX);
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
  context.strokeStyle = "#111923";
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(2, -4);
  context.lineTo(Math.cos(angle) * 27, Math.sin(angle) * 27 - 4);
  context.stroke();
  context.strokeStyle = "#d6ad60";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(1, 9);
  context.lineTo(Math.cos(angle + Math.PI / 2.4) * 25, Math.sin(angle + Math.PI / 2.4) * 25 + 9);
  context.stroke();
  if (state.slashUntil > 0) {
    context.strokeStyle = "#ffd166";
    context.lineWidth = 4;
    context.beginPath();
    context.arc(0, 0, 48, angle - 0.85, angle + 0.85);
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
  const name = isLocal ? "YOU" : state.name;
  context.strokeText(name, x, y - 49);
  context.fillText(name, x, y - 49);
}

function roundedRect(x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawReticle() {
  const mine = players.get(myId);
  if (!mine || mine.state.dead) return;
  context.strokeStyle = "rgba(233, 242, 231, 0.8)";
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
    context.fillStyle = "#ffd166";
    for (const bullet of latestSnapshot.bullets) {
      context.beginPath();
      context.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
      context.fill();
    }
  }
  for (const [id, player] of players) drawPlayer(player, id === myId);
  context.restore();
  drawReticle();
  sendInput(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
