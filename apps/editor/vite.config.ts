import { decoderAssets } from "../../packages/asset-pipeline/vite-decoders";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/editor/",
  plugins: [react(), decoderAssets()],
  publicDir: false,
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:18080" } },
  build: { sourcemap: true },
});
