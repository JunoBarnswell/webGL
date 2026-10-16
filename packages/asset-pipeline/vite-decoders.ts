import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";
const names = ["basis_transcoder.js", "basis_transcoder.wasm"];
export function decoderAssets(): Plugin {
  return {
    name: "studio-decoder-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.split("?")[0].split("/").at(-1) ?? "";
        if (!request.url?.includes("/decoders/") || !names.includes(name))
          return next();
        void readFile(
          new URL(
            "../../node_modules/three/examples/jsm/libs/basis/" + name,
            import.meta.url,
          ),
        )
          .then((bytes) => {
            response.setHeader(
              "Content-Type",
              name.endsWith("wasm") ? "application/wasm" : "text/javascript",
            );
            response.end(bytes);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      for (const name of names)
        this.emitFile({
          type: "asset",
          fileName: "decoders/" + name,
          source: await readFile(
            new URL(
              "../../node_modules/three/examples/jsm/libs/basis/" + name,
              import.meta.url,
            ),
          ),
        });
    },
  };
}
