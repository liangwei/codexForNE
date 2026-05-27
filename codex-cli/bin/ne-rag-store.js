import fs from "node:fs";
import path from "node:path";

const INDEX_VERSION = 1;
const DEFAULT_LIMIT = 20;

/**
 * Load the local NE RAG JSON vector index.
 */
export function loadRagIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return emptyIndex();
  }
  const value = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assertIndex(value, indexPath);
  return value;
}

/**
 * Persist the local NE RAG JSON vector index atomically.
 */
export function saveRagIndex(indexPath, index) {
  assertIndex(index, indexPath);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, indexPath);
}

/**
 * Insert or replace one document in the local NE RAG index.
 */
export function upsertRagDocument(index, input) {
  const existing = index.documents.find((doc) => doc.filePath === input.filePath);
  const document = {
    id: existing?.id ?? nextDocumentId(index),
    filePath: input.filePath,
    title: input.title,
    updatedAt: Date.now(),
    chunks: input.chunks,
  };
  const documents = index.documents
    .filter((doc) => doc.filePath !== input.filePath)
    .concat(document)
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
  return { version: INDEX_VERSION, documents };
}

/**
 * Return index-level document and chunk counts.
 */
export function countRagIndex(index) {
  return {
    documents: index.documents.length,
    chunks: index.documents.reduce((total, doc) => total + doc.chunks.length, 0),
  };
}

/**
 * List indexed local RAG documents.
 */
export function listRagDocuments(index, options = {}) {
  const query = normalize(options.query ?? "");
  const limit = positiveInteger(options.limit, DEFAULT_LIMIT);
  const docs = query
    ? index.documents.filter((doc) => documentSearchText(doc).includes(query))
    : index.documents;
  return docs.slice(0, limit).map(summarizeDocument);
}

/**
 * Search indexed chunks by cosine similarity.
 */
export function searchRagIndex(index, queryVector, options = {}) {
  const topK = positiveInteger(options.topK, 5);
  const documents = resolveSearchDocuments(index, options.document);
  const rows = documents.flatMap((doc) => doc.chunks.map((chunk) => scoreChunk(doc, chunk, queryVector)));
  if (rows.length === 0) {
    throw new Error("NE RAG index is empty. Run /rag-import <path> first.");
  }
  rows.sort((left, right) => right.similarity - left.similarity);
  return rows.slice(0, topK);
}

function emptyIndex() {
  return { version: INDEX_VERSION, documents: [] };
}

function nextDocumentId(index) {
  return index.documents.reduce((max, doc) => Math.max(max, doc.id), 0) + 1;
}

function resolveSearchDocuments(index, document) {
  if (typeof document !== "string" || !document.trim()) {
    return index.documents;
  }
  const docs = findMatchingDocuments(index, document);
  if (docs.length === 0) {
    throw new Error(`No indexed local RAG document matched: ${document}`);
  }
  if (docs.length === 1) {
    return docs;
  }
  throw new Error(`Ambiguous local RAG document: ${document}\nCandidates:\n${docs.map(formatDocumentChoice).join("\n")}`);
}

function findMatchingDocuments(index, term) {
  const normalized = normalize(term);
  const exact = index.documents.filter((doc) => exactDocumentKeys(doc).some((key) => normalize(key) === normalized));
  return exact.length > 0 ? exact : index.documents.filter((doc) => documentSearchText(doc).includes(normalized));
}

function exactDocumentKeys(doc) {
  return [String(doc.id), doc.title, path.basename(doc.filePath), doc.filePath];
}

function summarizeDocument(doc) {
  return {
    id: doc.id,
    filePath: doc.filePath,
    title: doc.title,
    chunks: doc.chunks.length,
    updatedAt: doc.updatedAt,
  };
}

function scoreChunk(doc, chunk, queryVector) {
  return {
    docId: doc.id,
    docTitle: doc.title,
    filePath: doc.filePath,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    similarity: cosine(queryVector, chunk.vector),
  };
}

function cosine(left, right) {
  if (left.length !== right.length) {
    throw new Error(`Vector dimension mismatch: ${left.length} !== ${right.length}`);
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function documentSearchText(doc) {
  return normalize(`${doc.id} ${doc.title} ${doc.filePath}`);
}

function formatDocumentChoice(doc) {
  return `- ${doc.id}: ${doc.title} (${doc.filePath})`;
}

function normalize(value) {
  return String(value).toLowerCase().replace(/\s+/g, "");
}

function positiveInteger(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error("Limit values must be positive integers.");
}

function assertIndex(value, indexPath) {
  if (!value || value.version !== INDEX_VERSION || !Array.isArray(value.documents)) {
    throw new Error(`${indexPath} is not a valid NE RAG index.`);
  }
}
