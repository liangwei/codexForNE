#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runNeAuthCommand } from "./ne-auth.js";
import { runNeRagCommand } from "./ne-rag-cli.js";

const args = process.argv.slice(2);
if (isVersionCommand(args)) {
  console.log(`necli ${readPackageVersion()}`);
  process.exit(0);
}

const authCommandExitCode = await runNeAuthCommand(args);
if (authCommandExitCode !== null) {
  process.exit(authCommandExitCode);
}

const ragCommandExitCode = await runNeRagCommand(args);
if (ragCommandExitCode !== null) {
  process.exit(ragCommandExitCode);
}

process.env.NECLI_ENABLE_DEFAULTS = "1";
await import("./codex.js");

function isVersionCommand(args) {
  return args.length === 1 && ["--version", "-V"].includes(args[0]);
}

function readPackageVersion() {
  const binDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.join(binDir, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error(`${packageJsonPath} must contain a string version.`);
  }

  return packageJson.version.trim();
}
