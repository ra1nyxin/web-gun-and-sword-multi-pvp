import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: "../../public",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 25653,
    strictPort: true,
    proxy: {
      "/socket.io": {
        target: "http://localhost:25654",
        ws: true,
      },
    },
  },
});
