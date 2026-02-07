import type { ActiveNoteInsight } from "@/components/chat-components/hooks/useActiveNoteInsight";
import type { CopilotSettings } from "@/settings/model";

/**
 * Royal-style title options for companion personalization.
 */
export const ROYAL_TITLE_OPTIONS = [
  "Your Grace",
  "My Liege",
  "Your Excellency",
  "My King",
  "My Queen",
  "Your Highness",
  "Your Majesty",
  "Sire",
  "Madam",
  "My Lord",
  "My Lady",
  "Your Serene Highness",
  "Your Illustrious Majesty",
  "Noble One",
  "Your Eminence",
  "Your Lordship",
  "Your Ladyship",
  "Esteemed One",
  "Most Gracious",
  "Your Elevation",
  "Noble Sovereign",
  "Your Prosperity",
  "Most Esteemed",
  "Your Distinction",
  "Revered One",
  "Your Splendor",
  "Most Worthy",
  "Your Ascendancy",
  "Illustrious Friend",
] as const;

/**
 * Shared context for generating companion tone copy.
 */
export interface CompanionToneContext {
  activeNote: ActiveNoteInsight;
  royalAddress: string;
  hasMessages: boolean;
  isGenerating: boolean;
  lastUserMessage?: string | null;
}

/**
 * Resolves the user's royal address from configured title and preferred name.
 */
export function resolveRoyalAddress(
  settings: Pick<CopilotSettings, "userPreferredName" | "userRoyalTitle">
): string {
  const title = settings.userRoyalTitle?.trim() || "Your Majesty";
  const preferredName = settings.userPreferredName?.trim();

  if (!preferredName) {
    return title;
  }

  return `${title} ${preferredName}`;
}

/**
 * Returns a short focus label from active note metadata.
 */
function resolveFocusLabel(activeNote: ActiveNoteInsight): string | null {
  if (activeNote.primaryHeading) {
    return activeNote.primaryHeading;
  }

  if (activeNote.fileName) {
    return activeNote.fileName;
  }

  return null;
}

/**
 * Cleans user-authored message text for short UI commentary snippets.
 */
function normalizeUserIntent(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const stripped = raw
    .replace(/\[\[[^\]]+]]/g, "")
    .replace(/@[\w-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped) {
    return null;
  }

  if (stripped.length <= 88) {
    return stripped;
  }

  return `${stripped.slice(0, 85).trimEnd()}...`;
}

/**
 * Builds a compact tag string for companion commentary.
 */
function resolveTagSnippet(tags: string[]): string | null {
  if (!tags.length) {
    return null;
  }

  const preview = tags
    .slice(0, 2)
    .map((tag) => `#${tag}`)
    .join(" ");
  return preview.length ? preview : null;
}

/**
 * Builds the dynamic presence line shown in the companion strip.
 * Uses varied, natural phrasing to feel alive rather than static.
 */
export function resolvePresenceLine(context: CompanionToneContext): string {
  const focusLabel = resolveFocusLabel(context.activeNote);
  const cleanIntent = normalizeUserIntent(context.lastUserMessage);
  const tagSnippet = resolveTagSnippet(context.activeNote.tags);

  if (context.isGenerating) {
    if (focusLabel) {
      return `Analyzing "${focusLabel}" — one moment.`;
    }

    return `Working on your request now.`;
  }

  if (context.hasMessages) {
    if (focusLabel && cleanIntent) {
      return `Tracking "${focusLabel}" — ready on "${cleanIntent}".`;
    }

    if (focusLabel && tagSnippet) {
      return `"${focusLabel}" in view (${tagSnippet}). What's next?`;
    }

    if (focusLabel) {
      return `Still on "${focusLabel}". Ask away.`;
    }

    if (cleanIntent) {
      return `Following up on: "${cleanIntent}".`;
    }

    return `Thread active. Ready for more.`;
  }

  if (focusLabel && tagSnippet) {
    return `"${focusLabel}" open — themes: ${tagSnippet}.`;
  }

  if (focusLabel) {
    return `"${focusLabel}" is open. Ready to work.`;
  }

  return `Standing by, ${context.royalAddress}.`;
}

/**
 * Builds the empty-state title for the companion hero.
 */
export function resolveEmptyStateTitle(context: CompanionToneContext): string {
  const focusLabel = resolveFocusLabel(context.activeNote);

  if (focusLabel) {
    return `Hendrik at your service. Let's explore "${focusLabel}"?`;
  }

  return `Where shall we begin, ${context.royalAddress}?`;
}

/**
 * Builds the empty-state subtitle for the companion hero.
 */
export function resolveEmptyStateSubtitle(context: CompanionToneContext): string {
  const focusLabel = resolveFocusLabel(context.activeNote);

  if (focusLabel && context.activeNote.outboundLinkCount > 0) {
    return `Summarise, lookup, cross-reference ${context.activeNote.outboundLinkCount} linked notes, or draft what comes next.`;
  }

  if (focusLabel) {
    return `Summarise, challenge assumptions, or draft the next section.`;
  }

  return `Ask a question, add context with @, or pick any note to start.`;
}

/**
 * Builds a short, context-aware commentary line to make the companion feel present.
 */
export function resolveVaultCommentary(context: CompanionToneContext): string {
  const focusLabel = resolveFocusLabel(context.activeNote);
  const tagSnippet = resolveTagSnippet(context.activeNote.tags);
  const cleanIntent = normalizeUserIntent(context.lastUserMessage);

  if (focusLabel && tagSnippet) {
    return `Current themes around "${focusLabel}": ${tagSnippet}.`;
  }

  if (focusLabel && context.activeNote.outboundLinkCount > 0) {
    return `"${focusLabel}" connects to ${context.activeNote.outboundLinkCount} nearby notes for fast cross-reference.`;
  }

  if (cleanIntent) {
    return `Last request tracked: "${cleanIntent}". I can turn it into a clear output.`;
  }

  return `Point me to a note or question and I will build from your vault context.`;
}
