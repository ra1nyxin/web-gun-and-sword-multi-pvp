export const PORT = 25653;
export const DEV_SOCKET_PORT = 25654;
export const INVENTORY_SIZE = 9;

export const WORLD = {
  width: 1600,
  height: 900,
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

export const PLATFORMS: PlatformDefinition[] = [
  { x: 800, y: 880, width: 1640, height: 48 },
  { x: 12, y: 450, width: 24, height: 900 },
  { x: 1588, y: 450, width: 24, height: 900 },
  { x: 350, y: 770, width: 300, height: 30 },
  { x: 1250, y: 770, width: 300, height: 30 },
  { x: 800, y: 670, width: 300, height: 30 },
  { x: 550, y: 575, width: 240, height: 30 },
  { x: 1050, y: 575, width: 240, height: 30 },
  { x: 800, y: 480, width: 240, height: 30 },
];

export const SPAWNS = [
  { x: 180, y: 760 },
  { x: 350, y: 710 },
  { x: 800, y: 615 },
  { x: 1050, y: 520 },
  { x: 1420, y: 760 },
];

export const LOOT_SPAWNS = [
  { x: 180, y: 820 },
  { x: 350, y: 720 },
  { x: 800, y: 620 },
  { x: 550, y: 525 },
  { x: 1050, y: 525 },
  { x: 800, y: 430 },
  { x: 1420, y: 820 },
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
    label: "SWORD",
    code: "SW",
    kind: "melee",
    color: "#ffd166",
    accent: "#fff2b3",
    cooldown: 480,
    damage: 44,
    range: 90,
  },
  pistol: {
    label: "PISTOL",
    code: "PI",
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
    label: "RIFLE",
    code: "RF",
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
    label: "SCATTER",
    code: "SG",
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
    label: "PLASMA",
    code: "PL",
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
    label: "MEDKIT",
    code: "+",
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

export type Snapshot = {
  serverTime: number;
  players: PlayerState[];
  bullets: BulletState[];
  pickups: PickupState[];
  killFeed: KillEvent[];
};
