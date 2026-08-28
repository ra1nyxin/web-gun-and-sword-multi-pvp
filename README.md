# Gun & Sword Arena

A browser multiplayer 2D arena game. Opening the page connects a player straight to the shared world.

## Run

```bash
./scripts/npm install
./scripts/npm run dev
```

Open `http://localhost:25653`. To let players on the LAN join, open `http://YOUR_LAN_IP:25653`.

## Controls

- `A` / `D` or arrow keys: move
- `W` or up arrow: jump
- Left click: fire gun
- Right click or `Q`: sword attack

## Production

```bash
./scripts/npm run build
./scripts/npm start
```

The production server listens on port `25653` and serves both the game and Socket.IO connection.

## Architecture

- The Canvas renderer draws the arena, fighters, weapons, and projectiles from code.
- Matter.js runs on the Node.js server as the authoritative physics and collision simulation.
- Socket.IO broadcasts snapshots at 20 Hz. There is no application-level player capacity limit.
