#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const RENDERER_URL = process.env.WF_ELECTRON_RENDERER_URL || "http://localhost:1420";

const children = new Map();
let exiting = false;

function spawnNamed(name, command, args, opts = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  children.set(name, child);
  child.on("error", (error) => {
    console.error(`Failed to start ${name}:`, error);
    shutdownAndExit(1);
  });
  child.on("exit", (code, signal) => {
    if (!exiting && code !== 0) {
      shutdownAndExit(code ?? (signal ? 128 : 1));
    }
  });
  return child;
}

function shutdownAndExit(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const [, child] of children.entries()) {
    if (child.pid && child.exitCode === null) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch (error) {
        void error;
      }
    }
  }
  setTimeout(500).then(() => process.exit(code));
}

async function waitForRenderer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(RENDERER_URL);
      if (response.ok) return;
    } catch (error) {
      void error;
    }
    await setTimeout(500);
  }
  throw new Error(`Timed out waiting for Electron renderer at ${RENDERER_URL}`);
}

process.on("SIGINT", () => shutdownAndExit(130));
process.on("SIGTERM", () => shutdownAndExit(143));

process.env.WF_ENABLE_VITE_PROXY = "true";
spawnNamed("server", "cargo", ["run", "--manifest-path", "apps/server/Cargo.toml"]);
spawnNamed("renderer", "bun", ["run", "--cwd", "apps/frontend", "dev:electron"]);

try {
  await waitForRenderer();
  spawnNamed("electron", "bun", ["run", "--cwd", "apps/electron", "build"]);
  await new Promise((resolve, reject) => {
    const build = children.get("electron");
    build.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Electron build failed")),
    );
  });
  children.delete("electron");
  spawnNamed("electron", "bun", ["run", "--cwd", "apps/electron", "start"], {
    env: {
      ...process.env,
      WF_ELECTRON_RENDERER_URL: RENDERER_URL,
    },
  });
} catch (error) {
  console.error(error);
  shutdownAndExit(1);
}
