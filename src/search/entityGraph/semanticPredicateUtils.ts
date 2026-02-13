import { ENTITY_SEMANTIC_PREDICATES, EntitySemanticPredicate } from "./types";

/**
 * Alias mapping from normalized predicate candidates to canonical semantic predicates.
 */
const SEMANTIC_PREDICATE_ALIAS_MAP: Readonly<Record<string, EntitySemanticPredicate>> = {
  parent: "parent_of",
  child: "child_of",
  sibling: "sibling_of",
  spouse: "spouse_of",
  house: "house_of",
  ally: "allied_with",
  allies_with: "allied_with",
  rival: "rival_of",
  enemy_of: "rival_of",
  opposes: "rival_of",
  locatedin: "located_in",
  residesin: "located_in",
  headquarteredin: "located_in",
  operatesin: "located_in",
  inhabits: "located_in",
  serves: "member_of",
  atwarwith: "rival_of",
  borderdisputewith: "borders",
  sacredto: "bound_to",
  storedin: "located_in",
};

/**
 * Normalizes a raw predicate candidate string into a lookup key.
 */
function normalizePredicateKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Parses a raw predicate value into canonical semantic predicate IDs.
 */
export function parseSemanticPredicate(value: unknown): EntitySemanticPredicate | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizePredicateKey(value);
  if (!normalized) {
    return null;
  }

  if (ENTITY_SEMANTIC_PREDICATES.includes(normalized as EntitySemanticPredicate)) {
    return normalized as EntitySemanticPredicate;
  }

  return SEMANTIC_PREDICATE_ALIAS_MAP[normalized] || null;
}
