export const PORT = 25653;
export const DEV_SOCKET_PORT = 25654;
export const INVENTORY_SIZE = 9;

export const WORLD = {
  width: 4800,
  height: 1800,
  gravityY: 1.15,
  playerWidth: 32,
  playerHeight: 42,
  playerSpeed: 6.8,
  jumpVelocity: -18.2,
  maxHealth: 100,
};

export type PlatformDefinition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ZoneDefinition = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  gridColor: string;
  accent: string;
};

export const ZONES: ZoneDefinition[] = [
  { name: "西岸平台", x: 0, y: 0, width: 800, height: WORLD.height, color: "#163039", gridColor: "#294b50", accent: "#d6ad60" },
  { name: "熔炉阶梯", x: 800, y: 0, width: 800, height: WORLD.height, color: "#382b2a", gridColor: "#5c4540", accent: "#ed8f57" },
  { name: "中枢长桥", x: 1600, y: 0, width: 800, height: WORLD.height, color: "#273348", gridColor: "#3d526c", accent: "#7bb6ff" },
  { name: "苔原高地", x: 2400, y: 0, width: 800, height: WORLD.height, color: "#29392e", gridColor: "#45604d", accent: "#8fca85" },
  { name: "东区货仓", x: 3200, y: 0, width: 800, height: WORLD.height, color: "#39312a", gridColor: "#5a4e40", accent: "#d6ad60" },
  { name: "天际塔楼", x: 4000, y: 0, width: 800, height: WORLD.height, color: "#302d42", gridColor: "#4c4967", accent: "#d971ef" },
];

export const PLATFORMS: PlatformDefinition[] = [
  { x: 2400, y: 1780, width: 4840, height: 48 },
  { x: 12, y: 900, width: 24, height: 1800 },
  { x: 4788, y: 900, width: 24, height: 1800 },

  { x: 220, y: 1670, width: 300, height: 30 },
  { x: 620, y: 1670, width: 240, height: 30 },
  { x: 430, y: 1570, width: 340, height: 30 },
  { x: 150, y: 1470, width: 220, height: 30 },
  { x: 700, y: 1470, width: 180, height: 30 },
  { x: 430, y: 1370, width: 240, height: 30 },
  { x: 210, y: 1270, width: 160, height: 30 },
  { x: 650, y: 1270, width: 160, height: 30 },

  { x: 970, y: 1670, width: 260, height: 30 },
  { x: 1450, y: 1670, width: 260, height: 30 },
  { x: 1220, y: 1570, width: 340, height: 30 },
  { x: 940, y: 1470, width: 200, height: 30 },
  { x: 1510, y: 1470, width: 180, height: 30 },
  { x: 1230, y: 1370, width: 300, height: 30 },
  { x: 1230, y: 1270, width: 160, height: 30 },

  { x: 1740, y: 1670, width: 220, height: 30 },
  { x: 2260, y: 1670, width: 220, height: 30 },
  { x: 1850, y: 1570, width: 300, height: 30 },
  { x: 2150, y: 1570, width: 300, height: 30 },
  { x: 2000, y: 1470, width: 620, height: 30 },
  { x: 1810, y: 1370, width: 180, height: 30 },
  { x: 2190, y: 1370, width: 180, height: 30 },
  { x: 2000, y: 1270, width: 260, height: 30 },
  { x: 2000, y: 1170, width: 120, height: 30 },

  { x: 2470, y: 1670, width: 240, height: 30 },
  { x: 3130, y: 1670, width: 200, height: 30 },
  { x: 2630, y: 1570, width: 260, height: 30 },
  { x: 2980, y: 1570, width: 240, height: 30 },
  { x: 2480, y: 1470, width: 160, height: 30 },
  { x: 3130, y: 1470, width: 180, height: 30 },
  { x: 2600, y: 1370, width: 180, height: 30 },
  { x: 3000, y: 1370, width: 180, height: 30 },
  { x: 2800, y: 1270, width: 300, height: 30 },

  { x: 3300, y: 1670, width: 160, height: 30 },
  { x: 3510, y: 1670, width: 160, height: 30 },
  { x: 3750, y: 1670, width: 160, height: 30 },
  { x: 3930, y: 1670, width: 140, height: 30 },
  { x: 3420, y: 1570, width: 180, height: 30 },
  { x: 3650, y: 1570, width: 240, height: 30 },
  { x: 3880, y: 1570, width: 180, height: 30 },
  { x: 3500, y: 1470, width: 140, height: 30 },
  { x: 3800, y: 1470, width: 200, height: 30 },
  { x: 3650, y: 1370, width: 300, height: 30 },
  { x: 3650, y: 1270, width: 120, height: 30 },

  { x: 4110, y: 1670, width: 180, height: 30 },
  { x: 4690, y: 1670, width: 160, height: 30 },
  { x: 4270, y: 1570, width: 180, height: 30 },
  { x: 4530, y: 1570, width: 180, height: 30 },
  { x: 4140, y: 1470, width: 160, height: 30 },
  { x: 4400, y: 1470, width: 180, height: 30 },
  { x: 4660, y: 1470, width: 160, height: 30 },
  { x: 4280, y: 1370, width: 180, height: 30 },
  { x: 4520, y: 1270, width: 180, height: 30 },
  { x: 4280, y: 1170, width: 180, height: 30 },
  { x: 4520, y: 1070, width: 180, height: 30 },
  { x: 4400, y: 970, width: 160, height: 30 },
];

export const SPAWNS = [
  { x: 100, y: 1710 },
  { x: 660, y: 1710 },
  { x: 900, y: 1710 },
  { x: 1500, y: 1710 },
  { x: 1700, y: 1710 },
  { x: 2300, y: 1710 },
  { x: 2500, y: 1710 },
  { x: 3100, y: 1710 },
  { x: 3300, y: 1710 },
  { x: 3900, y: 1710 },
  { x: 4100, y: 1710 },
  { x: 4700, y: 1710 },
];

export const LOOT_SPAWNS = [
  { x: 220, y: 1624 },
  { x: 430, y: 1524 },
  { x: 150, y: 1424 },
  { x: 430, y: 1324 },
  { x: 650, y: 1224 },
  { x: 970, y: 1624 },
  { x: 1220, y: 1524 },
  { x: 940, y: 1424 },
  { x: 1230, y: 1324 },
  { x: 1230, y: 1224 },
  { x: 1740, y: 1624 },
  { x: 1850, y: 1524 },
  { x: 2000, y: 1424 },
  { x: 1810, y: 1324 },
  { x: 2000, y: 1124 },
  { x: 2470, y: 1624 },
  { x: 2630, y: 1524 },
  { x: 2480, y: 1424 },
  { x: 2600, y: 1324 },
  { x: 2800, y: 1224 },
  { x: 3300, y: 1624 },
  { x: 3650, y: 1524 },
  { x: 3500, y: 1424 },
  { x: 3650, y: 1324 },
  { x: 3650, y: 1224 },
  { x: 4110, y: 1624 },
  { x: 4270, y: 1524 },
  { x: 4400, y: 1424 },
  { x: 4280, y: 1324 },
  { x: 4400, y: 924 },
];

export type ItemId = "sword" | "pistol" | "rifle" | "scattergun" | "plasma" | "medkit";
export type ItemKind = "melee" | "projectile" | "utility";
export type InventorySlot = ItemId | null;

export type ItemDefinition = {
  label: string;
  code: string;
  kind: ItemKind;
  color: string;
  accent: string;
  cooldown: number;
  damage?: number;
  range?: number;
  projectiles?: number;
  spread?: number;
  projectileSpeed?: number;
  projectileRadius?: number;
  projectileLifetime?: number;
  heal?: number;
};

export const ITEMS: Record<ItemId, ItemDefinition> = {
  sword: {
    label: "长剑",
    code: "剑",
    kind: "melee",
    color: "#ffd166",
    accent: "#fff2b3",
    cooldown: 480,
    damage: 44,
    range: 90,
  },
  pistol: {
    label: "手枪",
    code: "手",
    kind: "projectile",
    color: "#46c5d6",
    accent: "#d5fbff",
    cooldown: 240,
    damage: 26,
    projectiles: 1,
    projectileSpeed: 19,
    projectileRadius: 5,
    projectileLifetime: 1250,
  },
  rifle: {
    label: "步枪",
    code: "步",
    kind: "projectile",
    color: "#b8e986",
    accent: "#efffd8",
    cooldown: 105,
    damage: 15,
    projectiles: 1,
    projectileSpeed: 25,
    projectileRadius: 4,
    projectileLifetime: 1050,
  },
  scattergun: {
    label: "散弹枪",
    code: "散",
    kind: "projectile",
    color: "#ed8f57",
    accent: "#ffe1b8",
    cooldown: 650,
    damage: 10,
    projectiles: 6,
    spread: 0.46,
    projectileSpeed: 17,
    projectileRadius: 4,
    projectileLifetime: 680,
  },
  plasma: {
    label: "等离子炮",
    code: "能",
    kind: "projectile",
    color: "#d971ef",
    accent: "#ffd7ff",
    cooldown: 760,
    damage: 50,
    projectiles: 1,
    projectileSpeed: 13,
    projectileRadius: 9,
    projectileLifetime: 1500,
  },
  medkit: {
    label: "医疗包",
    code: "药",
    kind: "utility",
    color: "#76c893",
    accent: "#d7ffe3",
    cooldown: 700,
    heal: 48,
  },
};

export const STARTING_INVENTORY: InventorySlot[] = [
  "pistol",
  "sword",
  "rifle",
  null,
  null,
  null,
  null,
  null,
  null,
];

export type InputState = {
  left: boolean;
  right: boolean;
  jump: boolean;
  aimX: number;
  aimY: number;
};

export type InventoryState = {
  slots: InventorySlot[];
  selectedSlot: number;
};

export type PlayerState = {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  kills: number;
  deaths: number;
  dead: boolean;
  aimX: number;
  aimY: number;
  activeItem: ItemId | null;
  selectedSlot: number;
  weaponReadyIn: number;
  slashUntil: number;
};

export type BulletState = {
  id: string;
  item: ItemId;
  x: number;
  y: number;
};

export type PickupState = {
  id: string;
  item: ItemId;
  x: number;
  y: number;
};

export type KillEvent = {
  id: string;
  attacker: string;
  victim: string;
  item: ItemId;
};

export type ChatMessage = {
  id: string;
  sender: string;
  text: string;
  sentAt: number;
};

export type Snapshot = {
  serverTime: number;
  players: PlayerState[];
  bullets: BulletState[];
  pickups: PickupState[];
  killFeed: KillEvent[];
};
