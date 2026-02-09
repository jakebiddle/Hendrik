const DEFAULT_MAX_SIMILARITY_EMBEDDING_QUERIES = 24;

/**
 * Selects a representative subset of chunk embeddings for similarity search.
 * This bounds worst-case runtime for very large notes while preserving coverage
 * across the document from start to end.
 * @param embeddings - All chunk embeddings for the active note.
 * @param maxQueries - Maximum number of embedding queries to run.
 * @returns Selected embeddings in source-order.
 */
export function selectEmbeddingsForSimilaritySearch(
  embeddings: number[][],
  maxQueries = DEFAULT_MAX_SIMILARITY_EMBEDDING_QUERIES
): number[][] {
  if (maxQueries <= 0 || embeddings.length === 0) {
    return [];
  }

  if (embeddings.length <= maxQueries) {
    return embeddings;
  }

  if (maxQueries === 1) {
    return [embeddings[Math.floor(embeddings.length / 2)]];
  }

  const selected: number[][] = [];
  const lastIndex = embeddings.length - 1;
  for (let queryIndex = 0; queryIndex < maxQueries; queryIndex += 1) {
    const embeddingIndex = Math.round((queryIndex * lastIndex) / (maxQueries - 1));
    selected.push(embeddings[embeddingIndex]);
  }

  return selected;
}
