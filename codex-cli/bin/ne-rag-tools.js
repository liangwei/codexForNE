import { resolveNeToken } from "./ne-auth.js";
import { embedNeTexts } from "./ne-rag-embedding.js";
import { importRagPath } from "./ne-rag-indexer.js";
import { resolveNeRagIndexPath, NE_RAG_TOP_K } from "./ne-rag-config.js";
import { countRagIndex, listRagDocuments, loadRagIndex, searchRagIndex } from "./ne-rag-store.js";

const RAG_TOOL_NAMES = new Set([
  "ne_rag_import",
  "ne_rag_count_documents",
  "ne_rag_list_documents",
  "ne_rag_search",
]);

/**
 * MCP tool definitions for the local NE RAG vector index.
 */
export const NE_RAG_TOOLS = Object.freeze([
  tool(
    "ne_rag_import",
    "Import local .md or .txt files into the NE local vector index.",
    {
      path: stringProperty("File or directory path to import."),
    },
    ["path"],
    false,
  ),
  tool("ne_rag_count_documents", "Count indexed local NE RAG documents and chunks.", {}),
  tool(
    "ne_rag_list_documents",
    "List indexed local NE RAG documents.",
    {
      query: stringProperty("Optional title/path filter."),
      limit: integerProperty("Maximum documents to return. Default: 20."),
    },
  ),
  tool(
    "ne_rag_search",
    "Search the local NE RAG vector index.",
    {
      query: stringProperty("Semantic query for indexed local documents."),
      document: stringProperty("Optional document id, title, file name, or path."),
      topK: integerProperty(`Number of snippets to return. Default: ${NE_RAG_TOP_K}.`),
    },
    ["query"],
  ),
]);

/**
 * Check whether a tool belongs to the local NE RAG tool set.
 */
export function isNeRagToolName(name) {
  return RAG_TOOL_NAMES.has(name);
}

/**
 * Execute a local NE RAG MCP tool and return a standard MCP CallToolResult.
 */
export async function callNeRagTool(params) {
  const name = requireString(params?.name, "tools/call requires a tool name.");
  const args = objectOrEmpty(params?.arguments);
  const text = await executeRagTool(name, args);
  return { content: [{ type: "text", text }], isError: false };
}

async function executeRagTool(name, args) {
  switch (name) {
    case "ne_rag_import":
      return formatImportResult(await importRagPath(requireString(args.path, "path is required.")));
    case "ne_rag_count_documents":
      return formatStats(countRagIndex(loadRagIndex(resolveNeRagIndexPath())));
    case "ne_rag_list_documents":
      return formatDocuments(listRagDocuments(loadRagIndex(resolveNeRagIndexPath()), args));
    case "ne_rag_search":
      return formatHits(await searchLocalRag(args));
    default:
      throw new Error(`Unknown NE RAG tool: ${name}`);
  }
}

async function searchLocalRag(args) {
  const token = resolveNeToken();
  if (!token) {
    throw new Error("NE credentials are required for local RAG search. Run /login first.");
  }
  const query = requireString(args.query, "query is required.");
  const [queryVector] = await embedNeTexts({ token, texts: [query] });
  return searchRagIndex(loadRagIndex(resolveNeRagIndexPath()), queryVector, {
    document: optionalString(args.document),
    topK: optionalInteger(args.topK),
  });
}

function formatImportResult(result) {
  return [
    "Local NE RAG import completed.",
    `Files indexed: ${result.files}`,
    `Chunks indexed: ${result.chunks}`,
    `Index: ${result.indexPath}`,
  ].join("\n");
}

function formatStats(stats) {
  return `Local NE RAG index: ${stats.documents} document(s), ${stats.chunks} chunk(s).`;
}

function formatDocuments(docs) {
  if (docs.length === 0) {
    return "No indexed local RAG documents matched.";
  }
  return docs.map((doc) => `- ${doc.id}: ${doc.title} (${doc.chunks} chunk(s)) ${doc.filePath}`).join("\n");
}

function formatHits(hits) {
  if (hits.length === 0) {
    return "No local RAG snippets matched.";
  }
  return hits.map(formatHit).join("\n\n");
}

function formatHit(hit, index) {
  return `[${index + 1}] ${hit.docTitle} (${hit.filePath}#chunk-${hit.chunkIndex + 1}, similarity ${hit.similarity.toFixed(4)})\n${hit.text}`;
}

function tool(name, description, properties, required = [], readOnly = true) {
  return {
    name,
    description,
    inputSchema: {
      additionalProperties: false,
      properties,
      required,
      type: "object",
    },
    annotations: { readOnlyHint: readOnly },
  };
}

function stringProperty(description) {
  return { description, type: "string" };
}

function integerProperty(description) {
  return { description, minimum: 1, type: "integer" };
}

function objectOrEmpty(value) {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  throw new Error("MCP tool arguments must be an object.");
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalInteger(value) {
  if (value === undefined) {
    return undefined;
  }
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error("topK must be a positive integer.");
}

function requireString(value, message) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  throw new Error(message);
}
