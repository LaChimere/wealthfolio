const { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const ARCH_NAMES = new Map([
  [0, "x64"],
  [1, "ia32"],
  [2, "armv7l"],
  [3, "arm64"],
  [4, "universal"],
]);

module.exports = async function copyElectronSidecar(context) {
  const platform = context.electronPlatformName;
  const arch = resolveArchName(context.arch);
  const binaryName = platform === "win32" ? "wealthfolio-backend.exe" : "wealthfolio-backend";
  const sourcePath = path.join(
    context.packager.projectDir,
    "resources",
    "sidecars",
    `${platform}-${arch}`,
    binaryName,
  );
  const sourceAssetsPath = path.join(path.dirname(sourcePath), "backend-assets");
  const destinationDir = path.join(resolveResourcesDir(context), "sidecars");
  const destinationPath = path.join(destinationDir, binaryName);
  const destinationAssetsPath = path.join(destinationDir, "backend-assets");

  mkdirSync(destinationDir, { recursive: true });
  copyFileSync(sourcePath, destinationPath);
  rmSync(destinationAssetsPath, { force: true, recursive: true });
  cpSync(sourceAssetsPath, destinationAssetsPath, { recursive: true });
  if (platform !== "win32") {
    chmodSync(destinationPath, 0o755);
  }
};
module.exports.default = module.exports;

function resolveArchName(arch) {
  if (typeof arch === "number") {
    return ARCH_NAMES.get(arch) ?? String(arch);
  }
  return String(arch);
}

function resolveResourcesDir(context) {
  if (context.electronPlatformName === "darwin") {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
    );
  }

  return path.join(context.appOutDir, "resources");
}
