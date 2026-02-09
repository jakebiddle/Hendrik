/**
 * Types for Chronicle Question interactive cards embedded in AI responses.
 *
 * When Chronicle Mode is active, the AI can emit `<chronicle_question>` XML blocks
 * in its responses. These are parsed and rendered as interactive cards where the user
 * can select options or type custom answers inline within the chat.
 */

export interface ChronicleQuestion {
  /** Unique identifier for this question within a message */
  id: string;
  /** The question text displayed in the card */
  question: string;
  /** Optional multiple-choice options */
  options?: string[];
  /** Whether the user can enter a free-text answer in addition to (or instead of) selecting options */
  allowCustom: boolean;
  /** Whether multiple options can be selected simultaneously */
  multiSelect?: boolean;
  /** The user's answer(s). Populated when the user submits. */
  answer?: string | string[];
  /** Whether this question has been answered */
  isAnswered: boolean;
}

/**
 * Parsed result from a `<chronicle_question>` XML block within an AI message.
 * Used internally by the parser before surface-level rendering.
 */
export interface ParsedChronicleQuestion {
  /** The raw XML match for replacement */
  rawMatch: string;
  /** The start index of the match within the source string */
  startIndex: number;
  /** The parsed question data */
  question: ChronicleQuestion;
}
