export const PORT = 25653;
export const DEV_SOCKET_PORT = 25654;

export const WORLD = {
  width: 1600,
  height: 900,
  gravityY: 1.35,
  playerWidth: 32,
  playerHeight: 42,
  playerSpeed: 6.2,
  jumpVelocity: -16.5,
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
  { x: 330, y: 690, width: 300, height: 30 },
  { x: 800, y: 610, width: 260, height: 30 },
  { x: 1260, y: 710, width: 300, height: 30 },
  { x: 530, y: 440, width: 240, height: 30 },
  { x: 1080, y: 400, width: 240, height: 30 },
  { x: 800, y: 250, width: 220, height: 30 },
];

export const SPAWNS = [
  { x: 180, y: 760 },
  { x: 490, y: 360 },
  { x: 800, y: 190 },
  { x: 1110, y: 320 },
  { x: 1420, y: 760 },
];

export type InputState = {
  left: boolean;
  right: boolean;
  jump: boolean;
  aimX: number;
  aimY: number;
};

export type PlayerState = {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  health: number;
  kills: number;
  deaths: number;
  dead: boolean;
  slashUntil: number;
};

export type BulletState = {
  id: string;
  x: number;
  y: number;
};

export type Snapshot = {
  serverTime: number;
  players: PlayerState[];
  bullets: BulletState[];
};
