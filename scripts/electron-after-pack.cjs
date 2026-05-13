const { chmodSync, copyFileSync, mkdirSync } = require("node:fs");
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
  const binaryName = platform === "win32" ? "wealthfolio-server.exe" : "wealthfolio-server";
  const sourcePath = path.join(
    context.packager.projectDir,
    "resources",
    "sidecars",
    `${platform}-${arch}`,
    binaryName,
  );
  const destinationDir = path.join(resolveResourcesDir(context), "sidecars");
  const destinationPath = path.join(destinationDir, binaryName);

  mkdirSync(destinationDir, { recursive: true });
  copyFileSync(sourcePath, destinationPath);
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
