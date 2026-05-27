import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { loginToNe } from "./ne-login.js";
import {
  fetchAndStoreNeModelCatalog,
  resolveNeModelCatalogPath,
  resolveNeDefaultModel,
  saveNeDefaultModel,
} from "./ne-models.js";

export const NE_PROVIDER_ID = "ne";
export const NE_PROVIDER_NAME = "NE";
export const NE_API_BASE_URL = "https://gateway.inoteexpress.com/v1";
export const NE_TOKEN_ENV = "NE_CLI_API_KEY";
export const NE_GATEWAY_APP_SOURCE = "necli";
export const DEFAULT_NE_MODEL = "ne-scientific";

const NE_PASSWORD_ENV = "NE_CLI_PASSWORD";
const NE_HOME_ENV = "NE_CLI_HOME";
const DEFAULT_NE_HOME_DIR = ".ne-cli";

export function resolveDefaultModel(env = process.env) {
  return firstNonEmpty(env.NE_CLI_MODEL) || resolveNeDefaultModel(env);
}

export function resolveNeToken(env = process.env) {
  const envToken = firstNonEmpty(env[NE_TOKEN_ENV]);
  if (envToken) {
    return envToken;
  }

  const auth = readJsonIfExists(neHomePath("auth.json", env));
  const authToken = stringAt(auth, [NE_PROVIDER_ID, "key"]);
  return authToken;
}

/**
 * Resolve the per-user NE-CLI state directory.
 */
export function resolveNeHome(env = process.env) {
  return env[NE_HOME_ENV] || path.join(os.homedir(), DEFAULT_NE_HOME_DIR);
}

/**
 * Resolve the native CLI state root used by NE-CLI.
 */
export function resolveNeCodexHome(env = process.env) {
  return path.join(resolveNeHome(env), "codex-home");
}

export function formatNeGatewayToken(token) {
  const trimmed = token.trim().replace(/^Bearer\s+/i, "");
  return trimmed.includes("##")
    ? trimmed
    : `${NE_GATEWAY_APP_SOURCE}##${trimmed}`;
}

export async function runNeAuthCommand(args, env = process.env) {
  const [command, ...rest] = args;
  switch (command) {
    case "login":
      return runLoginCommand(rest, env);
    case "logout":
      return runLogoutCommand(env);
    case "auth":
      return runAuthCommand(rest, env);
    case "models":
      return runModelsCommand(rest, env);
    default:
      return null;
  }
}

async function runLoginCommand(args, env) {
  if (args.length === 1 && args[0] === "status") {
    const token = resolveNeToken(env);
    console.log(token ? "Logged in to NE." : "Not logged in to NE.");
    return token ? 0 : 1;
  }

  if (args.includes("--with-token")) {
    const token = await readTokenFromStdinOrEnv(env);
    if (!token) {
      console.error(
        `No token provided. Pipe a token to stdin or set ${NE_TOKEN_ENV}.`,
      );
      return 1;
    }

    saveNeToken(token, env);
    const loginResult = await fetchAndStoreNeModelCatalog(token, env);
    console.log(`Logged in to NE. Loaded ${loginResult.models.length} models.`);
    return 0;
  }

  const username = valueAfterFlag(args, "--username");
  if (!username) {
    console.error(
      "Usage: necli login --username <account>\nPassword must be provided by the TUI login prompt or stdin.",
    );
    return 1;
  }

  const password = await readPasswordFromStdinOrEnv(env);
  if (!password) {
    console.error(
      `No password provided. Pipe a password to stdin or set ${NE_PASSWORD_ENV}.`,
    );
    return 1;
  }

  const json = args.includes("--json");
  const result = await loginToNe({ username, password });
  saveNeToken(result.token, env);
  const loginResult = await fetchAndStoreNeModelCatalog(result.token, env);
  console.log(
    json
      ? JSON.stringify(loginResult)
      : `Logged in to NE. Loaded ${loginResult.models.length} models.`,
  );
  return 0;
}

function runLogoutCommand(env) {
  const authPath = neHomePath("auth.json", env);
  const auth = readJsonIfExists(authPath) || {};
  if (isObject(auth)) {
    delete auth[NE_PROVIDER_ID];
  }
  writeJsonAtomic(authPath, auth);
  deleteFileIfExists(resolveNeModelCatalogPath(env));
  console.log("Logged out of NE.");
  return 0;
}

function runAuthCommand(args, env) {
  if (args.length !== 1 || args[0] !== "token") {
    console.error("Usage: necli auth token");
    return 1;
  }

  const token = resolveNeToken(env);
  if (!token) {
    console.error(
      `NE credentials not found. Run /login in necli or set ${NE_TOKEN_ENV}.`,
    );
    return 1;
  }

  console.log(formatNeGatewayToken(token));
  return 0;
}

function runModelsCommand(args, env) {
  if (args.length === 2 && args[0] === "default") {
    saveNeDefaultModel(args[1], env);
    console.log(`Default NE model saved: ${args[1]}`);
    return 0;
  }

  console.error("Usage: necli models default <model>");
  return 1;
}

export function saveNeToken(token, env = process.env) {
  const authPath = neHomePath("auth.json", env);
  const auth = readJsonIfExists(authPath) || {};
  if (!isObject(auth)) {
    throw new Error(`${authPath} must contain a JSON object.`);
  }

  auth[NE_PROVIDER_ID] = {
    type: "api_key",
    key: token.trim(),
  };
  writeJsonAtomic(authPath, auth);
}

async function readTokenFromStdinOrEnv(env) {
  return readStdinOrEnv(env, NE_TOKEN_ENV);
}

async function readPasswordFromStdinOrEnv(env) {
  return readStdinOrEnv(env, NE_PASSWORD_ENV);
}

async function readStdinOrEnv(env, envName) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    const token = Buffer.concat(chunks).toString("utf8").trim();
    if (token) {
      return token;
    }
  }

  return firstNonEmpty(env[envName]);
}

export function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

export function stringAt(value, segments) {
  let current = value;
  for (const segment of segments) {
    if (!isObject(current)) {
      return null;
    }
    current = current[segment];
  }

  return typeof current === "string" && current.trim() ? current.trim() : null;
}

export function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function firstNonEmpty(...values) {
  return values
    .find((value) => typeof value === "string" && value.trim())
    ?.trim();
}

function deleteFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function neHomePath(fileName, env) {
  return path.join(neHome(env), fileName);
}

function neHome(env) {
  return resolveNeHome(env);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAfterFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return null;
  }
  return firstNonEmpty(args[index + 1]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runNeAuthCommand(process.argv.slice(2));
  if (exitCode === null) {
    console.error("Usage: ne-auth <login|logout|auth> ...");
    process.exit(1);
  }
  process.exit(exitCode);
}
