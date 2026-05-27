import path from "node:path";
import { resolveNeToken } from "./ne-auth.js";
import { embedNeTexts } from "./ne-rag-embedding.js";
import { resolveNeRagIndexPath } from "./ne-rag-config.js";
import { loadRagIndex, saveRagIndex, upsertRagDocument } from "./ne-rag-store.js";
import {
  chunkRagText,
  extractRagText,
  resolveRagInputPath,
  scanRagFiles,
} from "./ne-rag-text.js";

/**
 * Import one file or directory into the local NE RAG vector index.
 */
export async function importRagPath(inputPath, options = {}) {
  const env = options.env ?? process.env;
  const token = resolveNeToken(env);
  if (!token) {
    throw new Error("NE credentials are required for local RAG import. Run /login first.");
  }

  const rootPath = resolveRagInputPath(inputPath, options.cwd ?? process.cwd());
  const files = await scanRagFiles(rootPath);
  if (files.length === 0) {
    throw new Error(`No importable .md or .txt files found under: ${rootPath}`);
  }

  const indexPath = options.indexPath ?? resolveNeRagIndexPath(env);
  const result = await indexFiles(loadRagIndex(indexPath), files, token, options);
  saveRagIndex(indexPath, result.index);
  return {
    files: files.length,
    chunks: result.chunks,
    indexPath,
    rootPath,
  };
}

async function indexFiles(index, files, token, options) {
  let nextIndex = index;
  let totalChunks = 0;
  for (const filePath of files) {
    const document = await buildIndexedDocument(filePath, token, options);
    totalChunks += document.chunks.length;
    nextIndex = upsertRagDocument(nextIndex, document);
  }
  return { index: nextIndex, chunks: totalChunks };
}

async function buildIndexedDocument(filePath, token, options) {
  const text = await extractRagText(filePath);
  const chunks = chunkRagText(text);
  if (chunks.length === 0) {
    throw new Error(`No text extracted from ${filePath}`);
  }
  const vectors = await embedNeTexts({
    token,
    texts: chunks,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  });
  return {
    filePath,
    title: path.basename(filePath),
    chunks: chunks.map((textChunk, index) => ({
      chunkIndex: index,
      text: textChunk,
      vector: vectors[index],
    })),
  };
}
