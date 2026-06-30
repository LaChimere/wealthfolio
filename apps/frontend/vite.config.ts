import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

const apiTarget =
  process.env.VITE_API_TARGET || process.env.WF_API_TARGET || "http://127.0.0.1:8080";
const enableProxy = process.env.WF_ENABLE_VITE_PROXY === "true";
const serverProxy = enableProxy
  ? {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/docs": {
        target: apiTarget,
        changeOrigin: true,
      },
    }
  : undefined;

// Determine build target: "electron" for desktop and "web" for browser.
const buildTarget = process.env.BUILD_TARGET || "web";
const adapterTargets = {
  electron: "./src/adapters/electron",
  web: "./src/adapters/web",
} as const;
const platformTargets = {
  electron: "./src/adapters/electron/core",
  web: "./src/adapters/web/core",
} as const;

if (!(buildTarget in adapterTargets)) {
  throw new Error(`Unsupported BUILD_TARGET "${buildTarget}". Expected web or electron.`);
}

const resolvedBuildTarget = buildTarget as keyof typeof adapterTargets;

// https://vitejs.dev/config/
export default defineConfig({
  envDir: "../..",
  plugins: [react(), tailwindcss()],
  publicDir: "public",
  optimizeDeps: {
    include: ["lucide-react", "recharts"],
  },
  define: {
    __BUILD_TARGET__: JSON.stringify(buildTarget),
  },
  resolve: {
    alias: {
      "@wealthfolio/addon-sdk": path.resolve(__dirname, "../../packages/addon-sdk/src"),
      "@wealthfolio/ui": path.resolve(__dirname, "../../packages/ui/src"),
      // Conditional adapter alias based on build target
      "@/adapters": path.resolve(__dirname, adapterTargets[resolvedBuildTarget]),
      // Platform-specific core module for shared adapters
      "#platform": path.resolve(__dirname, platformTargets[resolvedBuildTarget]),
      "@": path.resolve(__dirname, "./src"),
    },
    extensions: [".js", ".ts", ".jsx", ".tsx", ".json"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: serverProxy,
    watch: {
      ignored: ["**/apps/electron/**"],
    },
  },
  envPrefix: ["VITE_", "CONNECT_"],
  build: {
    outDir: "../../dist",
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
  },
} as unknown as import("vitest/config").UserConfigExport);
