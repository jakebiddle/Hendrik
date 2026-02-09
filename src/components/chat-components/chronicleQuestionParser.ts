/**
 * Parser for `<chronicle_question>` XML blocks embedded in AI responses.
 *
 * Follows the same pattern as `parseToolCallMarkers()` in toolCallParser.ts —
 * splits the message into segments of interleaved text and chronicle questions,
 * which are then rendered by `ChatSingleMessage` via React portals.
 */

import { ChronicleQuestion } from "@/types/chronicleQuestion";

// ---------------------------------------------------------------------------
// Segment types (mirrors tool call parser pattern)
// ---------------------------------------------------------------------------

export interface ChronicleQuestionSegment {
  type: "chronicleQuestion";
  /** Placeholder HTML for DOM container insertion */
  content: string;
  question: ChronicleQuestion;
}

export interface TextSegment {
  type: "text";
  content: string;
}

export type ChronicleSegment = TextSegment | ChronicleQuestionSegment;

export interface ParsedChronicleQuestions {
  segments: ChronicleSegment[];
  /** All extracted questions (for convenience) */
  questions: ChronicleQuestion[];
  /** Whether any question blocks were found */
  hasQuestions: boolean;
}

// ---------------------------------------------------------------------------
// Regex for complete and streaming XML blocks
// ---------------------------------------------------------------------------

const COMPLETE_QUESTION_REGEX =
  /<chronicle_question\s+id="([^"]+)">\s*<question>([\s\S]*?)<\/question>\s*(?:<options>\s*([\s\S]*?)\s*<\/options>\s*)?(?:<allow_custom>(true|false)<\/allow_custom>\s*)?(?:<multi_select>(true|false)<\/multi_select>\s*)?<\/chronicle_question>/g;

const OPTION_REGEX = /<option>([\s\S]*?)<\/option>/g;

const INCOMPLETE_QUESTION_REGEX = /<chronicle_question\s+id="[^"]*">[\s\S]*$/;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a single `<chronicle_question>` match into a `ChronicleQuestion`.
 */
function parseQuestionMatch(match: RegExpExecArray): ChronicleQuestion {
  const [, id, questionText, optionsBlock, allowCustomStr, multiSelectStr] = match;

  const options: string[] = [];
  if (optionsBlock) {
    let optionMatch: RegExpExecArray | null;
    const optionRegex = new RegExp(OPTION_REGEX.source, "g");
    while ((optionMatch = optionRegex.exec(optionsBlock)) !== null) {
      const optionText = optionMatch[1].trim();
      if (optionText) {
        options.push(optionText);
      }
    }
  }

  return {
    id: id.trim(),
    question: questionText.trim(),
    options: options.length > 0 ? options : undefined,
    allowCustom: allowCustomStr ? allowCustomStr === "true" : true,
    multiSelect: multiSelectStr ? multiSelectStr === "true" : false,
    isAnswered: false,
  };
}

/**
 * Build a DOM container placeholder for a chronicle question.
 * The actual React component is mounted into this container by the rendering pipeline.
 */
function buildContainerPlaceholder(questionId: string, messageId: string): string {
  const containerId = `chronicle-question-${messageId}-${questionId}`;
  return `<div id="${containerId}" class="chronicle-question-container" data-question-id="${questionId}"></div>`;
}

/**
 * Parse `<chronicle_question>` blocks out of an AI message, splitting it into
 * interleaved text and question segments.
 *
 * For streaming messages with incomplete blocks, the trailing partial XML is
 * preserved as text (it will be re-parsed once complete).
 *
 * @param message - The raw AI message text (after markdown preprocessing)
 * @param messageId - The parent message id (for stable DOM container ids)
 * @param existingAnswers - Previously submitted answers to restore (from StoredMessage)
 * @param isStreaming - Whether the message is still being streamed
 * @returns Parsed segments and extracted questions
 */
export function parseChronicleQuestions(
  message: string,
  messageId: string,
  existingAnswers?: ChronicleQuestion[],
  isStreaming = false
): ParsedChronicleQuestions {
  const segments: ChronicleSegment[] = [];
  const questions: ChronicleQuestion[] = [];
  const regex = new RegExp(COMPLETE_QUESTION_REGEX.source, "g");

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(message)) !== null) {
    // Text before this question block
    if (match.index > lastIndex) {
      const textBefore = message.slice(lastIndex, match.index).trim();
      if (textBefore) {
        segments.push({ type: "text", content: textBefore });
      }
    }

    const question = parseQuestionMatch(match);

    // Restore existing answer if available (e.g., loading from chat history)
    if (existingAnswers) {
      const existing = existingAnswers.find((a) => a.id === question.id);
      if (existing?.isAnswered) {
        question.answer = existing.answer;
        question.isAnswered = true;
      }
    }

    questions.push(question);
    segments.push({
      type: "chronicleQuestion",
      content: buildContainerPlaceholder(question.id, messageId),
      question,
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after the last question
  if (lastIndex < message.length) {
    const remaining = message.slice(lastIndex);

    // During streaming, check for incomplete question block at the end
    if (isStreaming && INCOMPLETE_QUESTION_REGEX.test(remaining)) {
      // Split at the start of the incomplete block
      const incompleteMatch = remaining.match(INCOMPLETE_QUESTION_REGEX);
      if (incompleteMatch && incompleteMatch.index !== undefined) {
        const textBefore = remaining.slice(0, incompleteMatch.index).trim();
        if (textBefore) {
          segments.push({ type: "text", content: textBefore });
        }
        // The incomplete block is silently dropped — it'll be re-parsed next render
      } else {
        segments.push({ type: "text", content: remaining });
      }
    } else {
      if (remaining.trim()) {
        segments.push({ type: "text", content: remaining });
      }
    }
  }

  // If no segments were produced, return the whole message as text
  if (segments.length === 0 && message.trim()) {
    segments.push({ type: "text", content: message });
  }

  return {
    segments,
    questions,
    hasQuestions: questions.length > 0,
  };
}

/**
 * Strip `<chronicle_question>` XML blocks from a message string.
 * Used when we need the "clean" text without interactive elements
 * (e.g., for copy-to-clipboard, chat history display text).
 */
export function stripChronicleQuestionBlocks(message: string): string {
  return message.replace(new RegExp(COMPLETE_QUESTION_REGEX.source, "g"), "").trim();
}
