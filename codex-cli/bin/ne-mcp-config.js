import os from "os";

const DEFAULT_MCP_SERVER = "qingtibase";
const NOTEEXPRESS_SERVER = "noteexpress";
const QINGTI_SERVER = "qingtibase";

const QINGTI_PLATFORM_PACKAGES = Object.freeze({
  "win32-x64": "@aegean-org/qt-mcp-win32-x64",
  "linux-x64": "@aegean-org/qt-mcp-linux-x64",
  "darwin-x64": "@aegean-org/qt-mcp-darwin-x64",
  "darwin-arm64": "@aegean-org/qt-mcp-darwin-arm64",
});

const SERVER_ALIASES = Object.freeze({
  ne: NOTEEXPRESS_SERVER,
  noteexpress: NOTEEXPRESS_SERVER,
  qt: QINGTI_SERVER,
  qingti: QINGTI_SERVER,
  qingtibase: QINGTI_SERVER,
});

/**
 * Build Qingti MCP stdio command arguments for the current platform.
 */
export function buildQingtiMcpArgs(platform = {}) {
  const platformPackage = getQingtiPlatformPackage(platform);
  if (!platformPackage) {
    return ["-y", "@aegean-org/qt-mcp", "-transport", "stdio"];
  }
  return [
    "-y",
    "--package",
    "@aegean-org/qt-mcp",
    "--package",
    platformPackage,
    "qt-mcp",
    "-transport",
    "stdio",
  ];
}

/**
 * Resolve the Qingti native helper package for the current platform.
 */
export function getQingtiPlatformPackage(platform = {}) {
  const key = `${platform.platform ?? process.platform}-${platform.arch ?? process.arch}`;
  return QINGTI_PLATFORM_PACKAGES[key];
}

/**
 * Return the built-in NE/Qingti MCP server launchers.
 */
export function getDefaultNeMcpServers() {
  return {
    [NOTEEXPRESS_SERVER]: {
      command: "npx",
      args: ["-y", "@aegean-org/ne-mcp"],
    },
    [QINGTI_SERVER]: {
      command: "npx",
      args: buildQingtiMcpArgs(),
      cwd: os.homedir(),
    },
  };
}

/**
 * Resolve user-facing MCP aliases such as `ne`, `qt`, and `qingti`.
 */
export function resolveNeMcpServerName(name) {
  const normalized = String(name || DEFAULT_MCP_SERVER).toLowerCase();
  return SERVER_ALIASES[normalized] ?? normalized;
}
