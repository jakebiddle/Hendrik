import { getSettings } from "@/settings/model";

type ToolEvidenceTool = "localSearch" | "findNotesByTitle" | "readNote";

type ToolEvidence = {
  tool: ToolEvidenceTool;
  chunkId?: string;
  query?: string;
  matchScore?: number;
};

type ToolSource = {
  title: string;
  path: string;
  score: number;
  explanation?: {
    toolEvidence: ToolEvidence;
  } & Record<string, unknown>;
};

type LocalSearchStrength = {
  hasContextDocs: boolean;
  topScore: number;
  isWeak: boolean;
};

const LOCAL_SEARCH_WEAK_THRESHOLD = 0.25;
const MAX_SALIENT_TERMS = 10;
const DEFAULT_SOURCE_SCORE = 0.5;
const TITLE_SOURCE_LIMIT = 10;
const DEFAULT_LOCAL_SEARCH_QUERY = "notes";
const MAX_RETRIEVAL_QUERY_CHARS = 240;

const FALLBACK_EXCLUDED_PATH_SUBSTRINGS = [
  "obsidian files/hendrik/hendrik-conversations",
  "obsidian files/copilot/copilot-conversations",
  "hendrik-conversations",
  "copilot-conversations",
];

const RETRIEVAL_QUERY_STOP_MARKERS = [
  "when done",
  "use available retrieval tools",
  "using object args",
  "with the shape",
  "each proposal must include",
  "include confidence",
  "do not write frontmatter",
  "use only predicate values",
  "call submit",
  "tool:",
  "tools:",
];

/**
 * Normalize retrieval query text to a compact, search-friendly string.
 */
function normalizeRetrievalQuery(rawQuery: string): string {
  const normalizedWhitespace = rawQuery.replace(/\s+/g, " ").trim();
  if (!normalizedWhitespace) {
    return "";
  }

  const lower = normalizedWhitespace.toLowerCase();
  let cutoff = normalizedWhitespace.length;
  for (const marker of RETRIEVAL_QUERY_STOP_MARKERS) {
    const index = lower.indexOf(marker);
    if (index > 0 && index < cutoff) {
      cutoff = index;
    }
  }

  const sliced = normalizedWhitespace.slice(0, cutoff).trim();
  const primary = sliced || normalizedWhitespace;

  const firstSentence =
    primary
      .split(/(?<=[.!?])\s+/)
      .map((segment) => segment.trim())
      .find((segment) => segment.length >= 8) || primary;

  const compact = firstSentence
    .replace(/[{}[\]"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= MAX_RETRIEVAL_QUERY_CHARS) {
    return compact;
  }

  return compact.slice(0, MAX_RETRIEVAL_QUERY_CHARS).trim();
}

/**
 * Ensure salient terms are clean, bounded, and grounded in the normalized query.
 */
function normalizeSalientTermsForQuery(query: string, incomingTerms: string[]): string[] {
  const baseline = extractSalientTerms(query);
  const merged = [...incomingTerms, ...baseline];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const term of merged) {
    const cleaned = String(term || "").trim();
    if (!cleaned) {
      continue;
    }
    if (cleaned === "[object Object]" || cleaned.startsWith("[object ")) {
      continue;
    }

    const canonical = cleaned.toLowerCase();
    if (seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    normalized.push(cleaned);

    if (normalized.length >= MAX_SALIENT_TERMS) {
      break;
    }
  }

  return normalized;
}

/**
 * Parse a JSON payload when needed and return object-like data for safe reads.
 */
function parseToolPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload) {
    return null;
  }

  if (typeof payload === "object") {
    return payload as Record<string, unknown>;
  }

  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Best-effort basename extraction for display titles.
 */
function getBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const tail = normalized.split("/").pop() || normalized;
  return tail.replace(/\.md$/i, "") || path;
}

/**
 * Normalize string for case-insensitive path filtering.
 */
function normalizeText(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

/**
 * Parse and normalize qaExclusions setting into lowercase path fragments.
 */
function getQaExclusionFragments(): string[] {
  try {
    const raw = getSettings()?.qaExclusions || "";
    if (!raw) {
      return [];
    }

    return raw
      .split(",")
      .map((token) => {
        const trimmed = token.trim();
        if (!trimmed) {
          return "";
        }
        try {
          return normalizeText(decodeURIComponent(trimmed));
        } catch {
          return normalizeText(trimmed);
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * True when query is explicitly requesting direct file or note reads.
 */
export function isExplicitReadIntent(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }

  const lower = trimmed.toLowerCase();

  if (/\[\[[^\]]+\]\]/.test(trimmed)) {
    return true;
  }

  if (/\b[\w./\\-]+\.md\b/i.test(trimmed)) {
    return true;
  }

  if (/[A-Za-z0-9 _-]+\/[A-Za-z0-9 _./-]+/.test(trimmed)) {
    return true;
  }

  if (
    /\b(read|open|show|display|view|inspect|cat)\b.{0,40}\b(note|file|document|doc|markdown|md)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }

  if (/^(open|read|show|view)\s+[\w./\\-]+$/i.test(trimmed)) {
    return true;
  }

  return lower.startsWith("read [[") || lower.startsWith("open [[");
}

/**
 * Heuristic gate for retrieval-first routing on factual lore Q&A turns.
 */
export function shouldForceRetrievalFirstRouting(query: string): boolean {
  const withoutCommands = query.replace(/@\w+/g, " ").trim();
  if (!withoutCommands) {
    return false;
  }

  if (isExplicitReadIntent(withoutCommands)) {
    return false;
  }

  if (
    /^(create|write|edit|update|rename|move|delete|remove|add|set|start|stop|run|execute|format)\b/i.test(
      withoutCommands
    )
  ) {
    return false;
  }

  if (
    /\b(@web|@websearch|web search|internet search|search (the )?web|google)\b/i.test(
      withoutCommands
    )
  ) {
    return false;
  }

  if (/^(what time|time|date|weather|convert time|timezone)\b/i.test(withoutCommands)) {
    return false;
  }

  return true;
}

/**
 * Extract lexical salient terms from the raw query (deterministic, no LLM extraction).
 */
export function extractSalientTerms(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const tokens = query.split(/[\s\p{P}]+/u);

  for (const rawToken of tokens) {
    if (!rawToken) {
      continue;
    }

    const token = rawToken.trim();
    if (!token) {
      continue;
    }

    const normalized = token.toLowerCase();
    const isTag = token.startsWith("#");
    if (!isTag && token.length < 3) {
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      terms.push(token);
    }

    if (terms.length >= MAX_SALIENT_TERMS) {
      break;
    }
  }

  return terms;
}

/**
 * Build deterministic localSearch tool call payload for retrieval-first routing.
 */
export function buildForcedLocalSearchCall(query: string, salientTerms: string[]) {
  const normalizedQuery = normalizeRetrievalQuery(query.trim()) || DEFAULT_LOCAL_SEARCH_QUERY;
  const normalizedSalientTerms = normalizeSalientTermsForQuery(normalizedQuery, salientTerms);

  return {
    toolName: "localSearch" as const,
    args: {
      query: normalizedQuery,
      salientTerms: normalizedSalientTerms,
    },
  };
}

/**
 * Repair localSearch args for weaker tool-calling models that omit required fields.
 */
export function normalizeLocalSearchArgs(
  rawArgs: unknown,
  fallbackQuery: string
): {
  query: string;
  salientTerms: string[];
  timeRange?: unknown;
  _preExpandedQuery?: unknown;
} {
  const args =
    rawArgs && typeof rawArgs === "object" ? { ...(rawArgs as Record<string, unknown>) } : {};
  const explicitQuery =
    typeof args.query === "string" && args.query.trim().length > 0 ? args.query.trim() : "";
  const fallback = fallbackQuery.trim();
  const query =
    normalizeRetrievalQuery(explicitQuery || fallback) ||
    normalizeRetrievalQuery(DEFAULT_LOCAL_SEARCH_QUERY);

  const incomingTerms = Array.isArray(args.salientTerms)
    ? args.salientTerms
        .filter((term) => typeof term === "string")
        .map((term) => String(term).trim())
        .filter(Boolean)
        .filter((term) => term !== "[object Object]" && !term.startsWith("[object "))
    : [];
  const salientTerms = normalizeSalientTermsForQuery(query, incomingTerms);

  return {
    query,
    salientTerms,
    timeRange: args.timeRange,
    _preExpandedQuery: args._preExpandedQuery,
  };
}

/**
 * Evaluate localSearch result quality to decide if deterministic fallback is needed.
 */
export function evaluateLocalSearchStrength(localSearchPayload: unknown): LocalSearchStrength {
  const parsed = parseToolPayload(localSearchPayload);
  const documents =
    parsed?.type === "local_search" && Array.isArray(parsed.documents) ? parsed.documents : [];
  const includableDocs = documents.filter(
    (doc) => (doc as { includeInContext?: boolean })?.includeInContext !== false
  ) as Array<{ score?: number; rerank_score?: number }>;

  const hasContextDocs = includableDocs.length > 0;
  const topScore = includableDocs.reduce((maxScore, doc) => {
    const score =
      typeof doc.rerank_score === "number"
        ? doc.rerank_score
        : typeof doc.score === "number"
          ? doc.score
          : 0;
    return Math.max(maxScore, score);
  }, 0);

  return {
    hasContextDocs,
    topScore,
    isWeak: !hasContextDocs || topScore < LOCAL_SEARCH_WEAK_THRESHOLD,
  };
}

/**
 * Convert findNotesByTitle tool result into normalized source rows with tool evidence metadata.
 */
export function extractFindTitleSources(findNotesPayload: unknown): ToolSource[] {
  const parsed = parseToolPayload(findNotesPayload);
  const query = typeof parsed?.query === "string" ? parsed.query : undefined;
  const results = Array.isArray(parsed?.results) ? parsed.results : [];

  return results.slice(0, TITLE_SOURCE_LIMIT).map((row) => {
    const path = String((row as any)?.path || "");
    const title = String((row as any)?.title || getBasename(path) || "Untitled");
    const score = Number((row as any)?.score || 0);

    return {
      title,
      path,
      score,
      explanation: {
        toolEvidence: {
          tool: "findNotesByTitle",
          query,
          matchScore: score,
        },
      },
    };
  });
}

/**
 * Convert readNote tool result into normalized source rows with tool evidence metadata.
 */
export function extractReadNoteSources(readNotePayload: unknown): ToolSource[] {
  const parsed = parseToolPayload(readNotePayload);
  if (!parsed) {
    return [];
  }

  const status = typeof parsed.status === "string" ? parsed.status : undefined;
  if (status && status !== "ok") {
    return [];
  }

  const path = typeof parsed.notePath === "string" ? parsed.notePath : "";
  if (!path) {
    return [];
  }

  const title =
    typeof parsed.noteTitle === "string" && parsed.noteTitle.trim().length > 0
      ? parsed.noteTitle
      : getBasename(path);
  const chunkId = typeof parsed.chunkId === "string" ? parsed.chunkId : undefined;
  const score = chunkId ? 1 : DEFAULT_SOURCE_SCORE;

  return [
    {
      title,
      path,
      score,
      explanation: {
        toolEvidence: {
          tool: "readNote",
          chunkId,
          matchScore: score,
        },
      },
    },
  ];
}

/**
 * Pick highest-confidence markdown fallback candidate from title search output.
 */
export function pickBestFallbackPath(findNotesPayload: unknown): string | null {
  const parsed = parseToolPayload(findNotesPayload);
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const qaExclusions = getQaExclusionFragments();

  const filtered = results
    .map((row) => ({
      path: String((row as any)?.path || ""),
      score: Number((row as any)?.score || 0),
      extension: String((row as any)?.extension || ""),
    }))
    .filter((row) => row.path.length > 0)
    .filter((row) => row.extension.toLowerCase() === "md" || row.path.toLowerCase().endsWith(".md"))
    .filter((row) => {
      const normalizedPath = normalizeText(row.path);
      const excludedByDefault = FALLBACK_EXCLUDED_PATH_SUBSTRINGS.some((fragment) =>
        normalizedPath.includes(fragment)
      );
      if (excludedByDefault) {
        return false;
      }

      return !qaExclusions.some((fragment) => normalizedPath.includes(fragment));
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  return filtered.length > 0 ? filtered[0].path : null;
}
