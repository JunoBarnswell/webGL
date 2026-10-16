import { assetPipelineAssets } from "../../packages/asset-pipeline/vite-decoders";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react(), assetPipelineAssets()],
  base: "/player/",
  publicDir: false,
  server: { port: 5174, proxy: { "/api": "http://127.0.0.1:18080" } },
  build: { sourcemap: true },
});
