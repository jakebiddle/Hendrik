import { useActiveFile } from "@/hooks/useActiveFile";
import { CachedMetadata } from "obsidian";
import { useMemo } from "react";

/**
 * Metadata distilled from the currently active note to drive companion copy.
 */
export interface ActiveNoteInsight {
  fileName: string | null;
  filePath: string | null;
  primaryHeading: string | null;
  tags: string[];
  outboundLinkCount: number;
}

/**
 * Removes hash prefix and normalizes a tag string.
 */
function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").trim();
}

/**
 * Extracts up to three distinct tags from note metadata/frontmatter.
 */
function extractTags(cache: CachedMetadata | null): string[] {
  if (!cache) {
    return [];
  }

  const inlineTags = (cache.tags ?? []).map((entry) => normalizeTag(entry.tag));
  const frontmatterTagsRaw = cache.frontmatter?.tags;
  const frontmatterTags = Array.isArray(frontmatterTagsRaw)
    ? frontmatterTagsRaw.map((tag) => normalizeTag(String(tag)))
    : typeof frontmatterTagsRaw === "string"
      ? [normalizeTag(frontmatterTagsRaw)]
      : [];

  return Array.from(new Set([...inlineTags, ...frontmatterTags].filter(Boolean))).slice(0, 3);
}

/**
 * Returns compact, synchronous insight from the active note.
 */
export function useActiveNoteInsight(): ActiveNoteInsight {
  const activeFile = useActiveFile();

  return useMemo(() => {
    if (!activeFile) {
      return {
        fileName: null,
        filePath: null,
        primaryHeading: null,
        tags: [],
        outboundLinkCount: 0,
      };
    }

    const cache = app.metadataCache.getFileCache(activeFile);
    const primaryHeading = cache?.headings?.[0]?.heading?.trim() ?? null;
    const tags = extractTags(cache ?? null);
    const outboundLinkCount = cache?.links?.length ?? 0;

    return {
      fileName: activeFile.basename,
      filePath: activeFile.path,
      primaryHeading: primaryHeading?.length ? primaryHeading : null,
      tags,
      outboundLinkCount,
    };
  }, [activeFile]);
}
