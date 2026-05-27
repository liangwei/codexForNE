import { neHomePath } from "./ne-auth.js";

export const NE_DEFAULT_EMBED_MODEL = "bge-m3";
export const NE_RAG_INDEX_FILE = "rag-index.json";
export const NE_RAG_CHUNK_SIZE = 1600;
export const NE_RAG_CHUNK_OVERLAP = 250;
export const NE_RAG_TOP_K = 5;

/**
 * Resolve the local NE RAG vector index file.
 */
export function resolveNeRagIndexPath(env = process.env) {
  return neHomePath(NE_RAG_INDEX_FILE, env);
}
