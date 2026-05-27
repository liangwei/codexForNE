import {
  NE_API_BASE_URL,
  NE_PROVIDER_ID,
  NE_PROVIDER_NAME,
  resolveDefaultModel,
  resolveNeCodexHome,
  resolveNeToken,
} from "./ne-auth.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  fetchAndStoreNeModelCatalog,
  resolveNeModelCatalogPath,
} from "./ne-models.js";

const NE_MCP_SERVER_NAME = "ne_literature";
const CONFIG_TOML_FILE = "config.toml";
const NE_MCP_STARTUP_TIMEOUT_SEC = 5;
const NE_MCP_TOOL_TIMEOUT_SEC = 60;
const NE_MCP_ENV_VARS = Object.freeze([
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "PATH",
  "TEMP",
  "TMP",
  "SystemRoot",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "NE_CLI_API_KEY",
  "NE_CLI_HOME",
  "NE_CLI_MODEL",
  "TERM",
]);

/**
 * Applies NE provider defaults before handing control to the native CLI.
 */
export async function applyNeCliDefaults(args, env = process.env) {
  if (hasBypassArg(args) || hasNonNeProviderOverride(args)) {
    return args;
  }

  ensureNeCliState(env);
  await refreshCatalogForLoggedInUser(env);
  return [...buildNeConfigArgs(env, args), ...args];
}

function ensureNeCliState(env) {
  const codexHome = env.CODEX_HOME?.trim() || resolveNeCodexHome(env);
  fs.mkdirSync(codexHome, { recursive: true });
  env.CODEX_HOME = codexHome;
}

async function refreshCatalogForLoggedInUser(env) {
  const token = resolveNeToken(env);
  env.NECLI_AUTH_STATUS = token ? "logged-in" : "logged-out";
  if (!token || fs.existsSync(resolveNeModelCatalogPath(env))) {
    return;
  }
  await fetchAndStoreNeModelCatalog(token, env);
}

function buildNeConfigArgs(env, userArgs) {
  const model = resolveDefaultModel(env);
  const authHelperPath = fileURLToPath(new URL("./ne-auth.js", import.meta.url));
  const modelCatalogPath = resolveNeModelCatalogPath(env);
  const neCliPath = fileURLToPath(new URL("./necli.js", import.meta.url));
  env.NECLI_AUTH_HELPER = authHelperPath;
  env.NECLI_BIN_PATH = neCliPath;
  env.NECLI_NODE_BINARY = process.execPath;

  const configArgs = [
    "-c",
    `model_provider=${NE_PROVIDER_ID}`,
    "-c",
    `model=${model}`,
    "-c",
    `model_providers.${NE_PROVIDER_ID}.name=${NE_PROVIDER_NAME}`,
    "-c",
    `model_providers.${NE_PROVIDER_ID}.base_url=${NE_API_BASE_URL}`,
    "-c",
    `model_providers.${NE_PROVIDER_ID}.wire_api=responses`,
    "-c",
    `model_providers.${NE_PROVIDER_ID}.auth.command=${tomlString(process.execPath)}`,
    "-c",
    `model_providers.${NE_PROVIDER_ID}.auth.args=${tomlArray([
      authHelperPath,
      "auth",
      "token",
    ])}`,
    "-c",
    `model_providers.${NE_PROVIDER_ID}.auth.timeout_ms=5000`,
    "-c",
    `model_providers.${NE_PROVIDER_ID}.auth.refresh_interval_ms=1000`,
    "-c",
    `model_providers.${NE_PROVIDER_ID}.requires_openai_auth=false`,
    "-c",
    `model_providers.${NE_PROVIDER_ID}.supports_websockets=false`,
    "-c",
    "include_permissions_instructions=false",
    "-c",
    "include_collaboration_mode_instructions=false",
    "-c",
    "include_apps_instructions=false",
    "-c",
    "tui.show_tooltips=false",
    "-c",
    "skills.include_instructions=false",
    "-c",
    "features.plugins=false",
  ];
  if (fs.existsSync(modelCatalogPath)) {
    configArgs.push("-c", `model_catalog_json=${tomlString(modelCatalogPath)}`);
  }
  appendNeMcpConfigArgs(configArgs, env, userArgs);
  return configArgs;
}

function appendNeMcpConfigArgs(configArgs, env, userArgs) {
  if (userConfiguredMcpServer(env, userArgs, NE_MCP_SERVER_NAME)) {
    return;
  }

  const mcpServerPath = fileURLToPath(new URL("./ne-mcp-server.js", import.meta.url));
  const prefix = `mcp_servers.${NE_MCP_SERVER_NAME}`;
  configArgs.push(
    "-c",
    `${prefix}.command=${tomlString(process.execPath)}`,
    "-c",
    `${prefix}.args=${tomlArray([mcpServerPath])}`,
    "-c",
    `${prefix}.env_vars=${tomlArray(NE_MCP_ENV_VARS)}`,
    "-c",
    `${prefix}.startup_timeout_sec=${NE_MCP_STARTUP_TIMEOUT_SEC}`,
    "-c",
    `${prefix}.tool_timeout_sec=${NE_MCP_TOOL_TIMEOUT_SEC}`,
    "-c",
    `${prefix}.default_tools_approval_mode=${tomlString("approve")}`,
    "-c",
    `${prefix}.tools.ne_mcp_save_articles.approval_mode=${tomlString("prompt")}`,
    "-c",
    `${prefix}.tools.ne_rag_import.approval_mode=${tomlString("prompt")}`,
  );
}

function userConfiguredMcpServer(env, userArgs, serverName) {
  return hasMcpServerOverride(userArgs, serverName) || configTomlDefinesMcpServer(env, serverName);
}

function hasMcpServerOverride(args, serverName) {
  const plainPath = `mcp_servers.${serverName}`;
  const quotedPath = `mcp_servers."${serverName}"`;
  return configOverrideValues(args).some((value) => value.includes(plainPath) || value.includes(quotedPath));
}

function configOverrideValues(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const inlineValue = valueFromInlineConfigArg(args[index]);
    if (inlineValue) {
      values.push(inlineValue);
    }
    if ((args[index] === "-c" || args[index] === "--config") && index + 1 < args.length) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

function configTomlDefinesMcpServer(env, serverName) {
  const configPath = path.join(env.CODEX_HOME || resolveNeCodexHome(env), CONFIG_TOML_FILE);
  if (!fs.existsSync(configPath)) {
    return false;
  }
  const escaped = escapeRegex(serverName);
  const pattern = new RegExp(`^\\s*\\[mcp_servers\\.(?:"${escaped}"|${escaped})[\\].]`, "m");
  return pattern.test(fs.readFileSync(configPath, "utf8"));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBypassArg(args) {
  return args.some((arg) => ["--help", "-h", "--version", "-V"].includes(arg));
}

function hasNonNeProviderOverride(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const inlineValue = valueFromInlineConfigArg(arg);
    if (inlineValue && isNonNeProviderOverride(inlineValue)) {
      return true;
    }

    if ((arg === "-c" || arg === "--config") && index + 1 < args.length) {
      const value = args[index + 1];
      if (isNonNeProviderOverride(value)) {
        return true;
      }
    }
  }

  return false;
}

function valueFromInlineConfigArg(arg) {
  if (arg.startsWith("-c") && arg.length > 2) {
    return arg.slice(2);
  }

  const longPrefix = "--config=";
  if (arg.startsWith(longPrefix)) {
    return arg.slice(longPrefix.length);
  }

  return null;
}

function isNonNeProviderOverride(value) {
  const [rawKey, rawValue] = value.split("=", 2);
  if (rawKey?.trim() !== "model_provider") {
    return false;
  }

  const provider = rawValue?.trim().replace(/^["']|["']$/g, "");
  return provider !== "" && provider !== NE_PROVIDER_ID;
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(",")}]`;
}

function tomlString(value) {
  return JSON.stringify(value);
}
