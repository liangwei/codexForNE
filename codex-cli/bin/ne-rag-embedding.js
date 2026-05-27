import { formatNeGatewayToken, NE_API_BASE_URL } from "./ne-auth.js";
import { NE_DEFAULT_EMBED_MODEL } from "./ne-rag-config.js";

const EMBEDDINGS_PATH = "/embeddings";
const EMBEDDING_BATCH_SIZE = 32;

/**
 * Create embeddings through the NE OpenAI-compatible embedding endpoint.
 */
export async function embedNeTexts(options) {
  const texts = requireTexts(options?.texts);
  if (texts.length === 0) {
    return [];
  }
  const batches = [];
  for (let index = 0; index < texts.length; index += EMBEDDING_BATCH_SIZE) {
    batches.push(texts.slice(index, index + EMBEDDING_BATCH_SIZE));
  }
  const vectors = [];
  for (const batch of batches) {
    vectors.push(...(await embedBatch({ ...options, texts: batch })));
  }
  return vectors;
}

async function embedBatch(options) {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const response = await fetchImpl(`${NE_API_BASE_URL}${EMBEDDINGS_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${formatNeGatewayToken(requireToken(options.token))}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: NE_DEFAULT_EMBED_MODEL, input: options.texts }),
    signal: options.signal,
  });
  const data = await readEmbeddingJson(response);
  return parseEmbeddingResponse(data, options.texts.length);
}

async function readEmbeddingJson(response) {
  if (!response.ok) {
    throw new Error(`NE embedding request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function parseEmbeddingResponse(response, expectedCount) {
  const vectors = Array.isArray(response?.data)
    ? response.data.map((item) => item?.embedding)
    : undefined;
  if (!vectors || vectors.length !== expectedCount) {
    throw new Error(`NE embedding response returned ${vectors?.length ?? 0} vectors for ${expectedCount} inputs.`);
  }
  return vectors.map(parseVector);
}

function parseVector(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("NE embedding response contained an empty or invalid vector.");
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error("NE embedding response contained a non-numeric vector value.");
    }
    return item;
  });
}

function requireTexts(value) {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new Error("Embedding input must be an array of strings.");
}

function requireToken(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  throw new Error("NE credentials are required for local RAG embeddings. Run /login first.");
}

function resolveFetch(fetchImpl) {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (typeof resolved !== "function") {
    throw new Error("This Node.js runtime does not provide fetch.");
  }
  return resolved;
}
