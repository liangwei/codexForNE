import fs from "fs";
import os from "os";
import path from "path";

const NE_API_BASE_URL = "https://gateway.inoteexpress.com/v1";
const NE_MODEL_DICTIONARY_PATH = "/models";
const NE_GATEWAY_APP_SOURCE = "necli";
const NE_HOME_ENV = "NE_CLI_HOME";
const DEFAULT_NE_HOME_DIR = ".ne-cli";
const DEFAULT_NE_MODEL = "ne-scientific";
const MODELS_FILE = "models.json";
const DEFAULT_MODEL_FILE = "default-model.json";
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 8192;
const NE_DEFAULT_EMBED_MODEL = "bge-m3";
const EMBEDDING_MODEL_TYPE_PATTERN = /(^|[-_/\s])embeddings?($|[-_/\s])/u;
const MODEL_TYPE_KEYS = ["type", "model_type", "modelType", "api", "mode", "category", "task"];
const ID_KEYS = ["id", "model", "model_id", "modelId"];
const NAME_KEYS = ["name", "display_name", "displayName", "label"];
const CONTEXT_KEYS = ["contextWindow", "context_window", "contextLength", "context_length"];
const MAX_TOKENS_KEYS = ["maxTokens", "max_tokens", "maxOutputTokens", "max_output_tokens"];
const REASONING_KEYS = ["reasoning", "supportReasoning", "supports_reasoning"];
const IMAGE_KEYS = ["supportsImage", "supports_image", "vision"];
const INPUT_KEYS = ["input", "inputs", "input_modalities", "inputModalities"];
const REASONING_LEVELS = Object.freeze([
  { effort: "low", description: "Low reasoning" },
  { effort: "medium", description: "Medium reasoning" },
  { effort: "high", description: "High reasoning" },
  { effort: "xhigh", description: "Extra high reasoning" },
]);
const NO_REASONING_LEVELS = Object.freeze([
  { effort: "none", description: "No reasoning" },
]);

/**
 * Return the NE model catalog file used by the native `model_catalog_json`.
 */
export function resolveNeModelCatalogPath(env = process.env) {
  return neHomePath(MODELS_FILE, env);
}

/**
 * Resolve the stored NE default model, falling back only before a catalog exists.
 */
export function resolveNeDefaultModel(env = process.env) {
  return readSavedDefaultModel(env) ?? DEFAULT_NE_MODEL;
}

/**
 * Persist the default NE model and keep the native catalog priority in sync.
 */
export function saveNeDefaultModel(model, env = process.env) {
  const defaultModel = validateModelName(model);
  const catalogRecord = readJsonIfExists(resolveNeModelCatalogPath(env));
  if (!isRecord(catalogRecord) || !Array.isArray(catalogRecord.models)) {
    throw new Error(`${MODELS_FILE} must contain a model catalog before saving a default model.`);
  }
  assertDefaultModelExists(defaultModel, catalogRecord.models);
  writeDefaultModel(defaultModel, env);
  writeJsonAtomic(resolveNeModelCatalogPath(env), {
    models: prioritizeDefaultModel(catalogRecord.models, defaultModel),
  });
}

/**
 * Fetch the NE model dictionary, persist native-compatible metadata, and return TUI presets.
 */
export async function fetchAndStoreNeModelCatalog(token, env = process.env) {
  const catalog = await fetchNeModelDictionary(token);
  const firstModel = catalog[0]?.slug;
  if (!firstModel) {
    throw new Error("NE model dictionary did not include any chat models.");
  }

  const savedDefault = readSavedDefaultModel(env);
  const defaultModel = savedDefault ?? firstModel;
  assertDefaultModelExists(defaultModel, catalog);
  if (!savedDefault) {
    writeDefaultModel(defaultModel, env);
  }

  const orderedCatalog = prioritizeDefaultModel(catalog, defaultModel);
  writeJsonAtomic(resolveNeModelCatalogPath(env), { models: orderedCatalog });
  return {
    default_model: defaultModel,
    models: orderedCatalog.map((model) => toModelPreset(model, defaultModel)),
  };
}

/**
 * Fetch and convert the NE model dictionary to native `ModelInfo` entries.
 */
export async function fetchNeModelDictionary(token, fetchImpl = fetch) {
  const response = await fetchImpl(`${NE_API_BASE_URL}${NE_MODEL_DICTIONARY_PATH}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${formatNeGatewayToken(token)}`,
    },
  });
  const data = await readJsonResponse(response);
  assertSuccessfulDictionaryResponse(data);
  const entries = extractModelEntries(data);
  const chatEntries = entries.filter((entry) => !isEmbeddingModelEntry(entry));
  if (chatEntries.length === 0) {
    throw new Error("NE model dictionary did not include any chat models.");
  }
  return chatEntries.map(parseModelInfo);
}

function parseModelInfo(entry, index) {
  if (typeof entry === "string") {
    return buildModelInfo(entry, entry, {}, index);
  }
  if (!isRecord(entry)) {
    throw new Error(`NE model dictionary entry ${index + 1} was not an object or string.`);
  }

  const id = getRequiredStringField(entry, ID_KEYS, index);
  const name = getStringField(entry, NAME_KEYS) ?? id;
  return buildModelInfo(id, name, entry, index);
}

function buildModelInfo(id, name, entry, index) {
  const reasoning = getBooleanField(entry, REASONING_KEYS) ?? true;
  const contextWindow = getPositiveNumberField(entry, CONTEXT_KEYS, DEFAULT_CONTEXT_WINDOW, index);
  return {
    slug: id,
    display_name: name,
    description: getStringField(entry, ["description", "desc"]) ?? `NE model ${name}`,
    default_reasoning_level: reasoning ? "xhigh" : "none",
    supported_reasoning_levels: reasoning ? [...REASONING_LEVELS] : [...NO_REASONING_LEVELS],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: index,
    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
    availability_nux: null,
    upgrade: null,
    base_instructions: "",
    model_messages: null,
    supports_reasoning_summaries: false,
    default_reasoning_summary: "auto",
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text",
    truncation_policy: { mode: "tokens", limit: contextWindow },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,
    context_window: contextWindow,
    max_context_window: contextWindow,
    auto_compact_token_limit: null,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: getModelInput(entry),
    supports_search_tool: false,
    max_tokens: getPositiveNumberField(entry, MAX_TOKENS_KEYS, DEFAULT_MAX_TOKENS, index),
  };
}

function toModelPreset(info, defaultModel) {
  return {
    id: info.slug,
    model: info.slug,
    display_name: info.display_name,
    description: info.description ?? "",
    default_reasoning_effort: info.default_reasoning_level ?? "none",
    supported_reasoning_efforts: info.supported_reasoning_levels,
    supports_personality: false,
    additional_speed_tiers: info.additional_speed_tiers,
    service_tiers: info.service_tiers,
    default_service_tier: info.default_service_tier,
    is_default: info.slug === defaultModel,
    upgrade: null,
    show_in_picker: info.visibility === "list",
    availability_nux: info.availability_nux,
    supported_in_api: info.supported_in_api,
    input_modalities: info.input_modalities,
  };
}

function prioritizeDefaultModel(catalog, defaultModel) {
  return catalog
    .map((model, index) => ({
      ...model,
      priority: model.slug === defaultModel ? 0 : index + 1,
    }))
    .sort((left, right) => left.priority - right.priority);
}

function validateModelName(model) {
  if (typeof model === "string" && model.trim()) {
    return model.trim();
  }
  throw new Error("NE default model must be a non-empty string.");
}

function assertDefaultModelExists(defaultModel, catalog) {
  if (catalog.some((model) => model.slug === defaultModel)) {
    return;
  }
  throw new Error(`Stored NE default model is not in the model dictionary: ${defaultModel}`);
}

async function readJsonResponse(response) {
  if (!response.ok) {
    throw new Error(`NE model dictionary request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function assertSuccessfulDictionaryResponse(value) {
  if (!isRecord(value) || value.code === undefined || value.code === 0 || value.code === "0") {
    return;
  }

  const message = typeof value.msg === "string" && value.msg.trim() ? value.msg : String(value.code);
  throw new Error(`NE model dictionary failed: ${message}`);
}

function extractModelEntries(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    throw new Error("NE model dictionary response was not an object or array.");
  }

  const data = value.data;
  if (Array.isArray(data)) {
    return data;
  }
  if (isRecord(data)) {
    const nested = getArrayField(data, ["models", "list", "items"]);
    if (nested) {
      return nested;
    }
  }

  const topLevel = getArrayField(value, ["models", "list", "items"]);
  if (topLevel) {
    return topLevel;
  }
  throw new Error("NE model dictionary response did not include a model array.");
}

function isEmbeddingModelEntry(entry) {
  const id = typeof entry === "string" ? entry : getStringFieldIfRecord(entry, ID_KEYS);
  if (id && id.trim().toLowerCase() === NE_DEFAULT_EMBED_MODEL) {
    return true;
  }
  const type = getStringFieldIfRecord(entry, MODEL_TYPE_KEYS);
  return type ? EMBEDDING_MODEL_TYPE_PATTERN.test(type.trim().toLowerCase()) : false;
}

function getModelInput(entry) {
  const value = firstPresentField(entry, INPUT_KEYS);
  if (value === undefined) {
    return getBooleanField(entry, IMAGE_KEYS) ? ["text", "image"] : ["text"];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("NE model input must be a non-empty array when provided.");
  }
  return value.map((item) => {
    if (item === "text" || item === "image") {
      return item;
    }
    throw new Error(`Unsupported NE model input type: ${String(item)}`);
  });
}

function getArrayField(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return undefined;
}

function getRequiredStringField(record, keys, index) {
  const value = getStringField(record, keys);
  if (value) {
    return value;
  }
  throw new Error(`NE model dictionary entry ${index + 1} did not include a model id.`);
}

function getStringFieldIfRecord(value, keys) {
  return isRecord(value) ? getStringField(value, keys) : undefined;
}

function getStringField(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function getBooleanField(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function getPositiveNumberField(record, keys, defaultValue, index) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value === "number" && value > 0) {
      return value;
    }
    throw new Error(`NE model dictionary entry ${index + 1} field "${key}" must be a positive number.`);
  }
  return defaultValue;
}

function firstPresentField(record, keys) {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function readSavedDefaultModel(env) {
  const record = readJsonIfExists(neHomePath(DEFAULT_MODEL_FILE, env));
  if (record === null) {
    return null;
  }
  if (!isRecord(record) || typeof record.model !== "string" || !record.model.trim()) {
    throw new Error(`${DEFAULT_MODEL_FILE} must contain a non-empty string model.`);
  }
  return record.model.trim();
}

function writeDefaultModel(model, env) {
  writeJsonAtomic(neHomePath(DEFAULT_MODEL_FILE, env), { model });
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function formatNeGatewayToken(token) {
  const trimmed = token.trim().replace(/^Bearer\s+/i, "");
  return trimmed.includes("##") ? trimmed : `${NE_GATEWAY_APP_SOURCE}##${trimmed}`;
}

function neHomePath(fileName, env) {
  return path.join(neHome(env), fileName);
}

function neHome(env) {
  return env[NE_HOME_ENV] || path.join(os.homedir(), DEFAULT_NE_HOME_DIR);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
