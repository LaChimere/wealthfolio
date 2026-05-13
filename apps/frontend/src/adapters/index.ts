// Re-export from Electron adapter by default (for TypeScript type-checking)
// At build time, Vite's resolve.alias will override this to point to
// either electron/index.ts or web/index.ts based on BUILD_TARGET.

export * from "./electron";
