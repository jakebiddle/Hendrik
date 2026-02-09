import { selectEmbeddingsForSimilaritySearch } from "@/search/relevantNotesSearchUtils";

/**
 * Builds deterministic one-dimensional embeddings for selection tests.
 */
function buildEmbeddings(count: number): number[][] {
  return Array.from({ length: count }, (_, index) => [index]);
}

describe("selectEmbeddingsForSimilaritySearch", () => {
  it("returns all embeddings when under the limit", () => {
    const embeddings = buildEmbeddings(4);
    expect(selectEmbeddingsForSimilaritySearch(embeddings, 8)).toEqual(embeddings);
  });

  it("returns an empty list when max queries is zero", () => {
    const embeddings = buildEmbeddings(6);
    expect(selectEmbeddingsForSimilaritySearch(embeddings, 0)).toEqual([]);
  });

  it("selects evenly distributed embeddings when over the limit", () => {
    const embeddings = buildEmbeddings(50);
    const selected = selectEmbeddingsForSimilaritySearch(embeddings, 5);

    expect(selected).toHaveLength(5);
    expect(selected[0]).toEqual([0]);
    expect(selected[4]).toEqual([49]);
    expect(selected.map((embedding) => embedding[0])).toEqual([0, 12, 25, 37, 49]);
  });

  it("returns a middle embedding when one query is requested", () => {
    const embeddings = buildEmbeddings(9);
    const selected = selectEmbeddingsForSimilaritySearch(embeddings, 1);
    expect(selected).toEqual([[4]]);
  });
});
