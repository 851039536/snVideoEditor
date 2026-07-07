// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        external: ["fluent-ffmpeg", "ffmpeg-static"]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload"
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer/src")
      }
    },
    plugins: [vue()],
    build: {
      outDir: "out/renderer"
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: ""
        }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
