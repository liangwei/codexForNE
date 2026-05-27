import {
  NE_API_BASE_URL,
  NE_PROVIDER_ID,
  NE_PROVIDER_NAME,
  resolveDefaultModel,
  resolveNeCodexHome,
  resolveNeToken,
} from "./ne-auth.js";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  fetchAndStoreNeModelCatalog,
  resolveNeModelCatalogPath,
} from "./ne-models.js";

/**
 * Applies NE provider defaults before handing control to the native CLI.
 */
export async function applyNeCliDefaults(args, env = process.env) {
  if (hasBypassArg(args) || hasNonNeProviderOverride(args)) {
    return args;
  }

  ensureNeCliState(env);
  await refreshCatalogForLoggedInUser(env);
  return [...buildNeConfigArgs(env), ...args];
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

function buildNeConfigArgs(env) {
  const model = resolveDefaultModel(env);
  const authHelperPath = fileURLToPath(new URL("./ne-auth.js", import.meta.url));
  const modelCatalogPath = resolveNeModelCatalogPath(env);
  env.NECLI_AUTH_HELPER = authHelperPath;
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
  return configArgs;
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
