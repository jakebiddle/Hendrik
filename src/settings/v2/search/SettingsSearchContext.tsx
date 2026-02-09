import React, { createContext, useContext, useMemo, useState } from "react";

interface SettingsSearchContextValue {
  /** Raw query entered by the user. */
  query: string;
  /** Normalized lowercase query used for matching. */
  normalizedQuery: string;
  /** True when a non-empty query is active. */
  hasQuery: boolean;
  /** Updates the current query. */
  setQuery: (query: string) => void;
  /**
   * Checks whether provided terms match the active query.
   * Returns true when no query is active.
   */
  matches: (terms?: string | string[]) => boolean;
}

const SettingsSearchContext = createContext<SettingsSearchContextValue | undefined>(undefined);

/**
 * Normalizes user-entered query text.
 *
 * @param value - Input value to normalize.
 * @returns Lowercased, trimmed value.
 */
export function normalizeSettingsSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Determines whether search terms satisfy a query.
 * Every query token must be present in the joined terms.
 *
 * @param query - Normalized query string.
 * @param terms - Candidate terms to evaluate.
 * @returns True if terms match query; otherwise false.
 */
export function matchesSettingsSearchQuery(query: string, terms?: string | string[]): boolean {
  if (!query) {
    return true;
  }

  if (!terms || (Array.isArray(terms) && terms.length === 0)) {
    return false;
  }

  const haystack = (Array.isArray(terms) ? terms : [terms]).join(" ").toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);

  return tokens.every((token) => haystack.includes(token));
}

interface SettingsSearchProviderProps {
  children: React.ReactNode;
}

/**
 * Provides settings search state and term-matching helpers.
 */
export function SettingsSearchProvider({ children }: SettingsSearchProviderProps) {
  const [query, setQuery] = useState("");

  const value = useMemo<SettingsSearchContextValue>(() => {
    const normalizedQuery = normalizeSettingsSearchQuery(query);

    return {
      query,
      normalizedQuery,
      hasQuery: normalizedQuery.length > 0,
      setQuery,
      matches: (terms?: string | string[]) => matchesSettingsSearchQuery(normalizedQuery, terms),
    };
  }, [query]);

  return <SettingsSearchContext.Provider value={value}>{children}</SettingsSearchContext.Provider>;
}

/**
 * Reads settings search context.
 *
 * @returns Current settings search state.
 */
export function useSettingsSearch(): SettingsSearchContextValue {
  const context = useContext(SettingsSearchContext);

  if (!context) {
    throw new Error("useSettingsSearch must be used inside SettingsSearchProvider");
  }

  return context;
}

/**
 * Reads settings search context when available.
 *
 * @returns Search context or undefined when provider is absent.
 */
export function useOptionalSettingsSearch(): SettingsSearchContextValue | undefined {
  return useContext(SettingsSearchContext);
}
