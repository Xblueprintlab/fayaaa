import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/fayaaa/",
  plugins: [wgslVitePlugin()],
  build: {
    outDir: "dist/fayaaa",
  },
});
