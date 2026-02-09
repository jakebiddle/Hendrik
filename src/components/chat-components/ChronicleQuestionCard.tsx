/* eslint-disable tailwindcss/no-custom-classname */
/**
 * Interactive card component rendered inline within AI messages when Chronicle Mode
 * emits `<chronicle_question>` XML blocks.
 *
 * - **Unanswered state**: Shows question, radio/checkbox options, optional free-text input, submit button
 * - **Answered state**: Compact card with selected answer and a "Change" button
 *
 * Mounted as a React portal into a DOM container inside the Obsidian-rendered markdown,
 * following the same pattern as `ToolCallBanner`.
 */

import { Button } from "@/components/ui/button";
import { ChronicleQuestion } from "@/types/chronicleQuestion";
import { Check, HelpCircle, RotateCcw } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Regex to match `<a href="obsidian://open?file=...">linkText</a>` produced by the
 * wikilink-to-HTML preprocessing step in ChatSingleMessage.
 */
const OBSIDIAN_LINK_REGEX = /<a\s+href="(obsidian:\/\/open\?file=[^"]*)">(.*?)<\/a>/g;

/**
 * Renders a string that may contain `<a href="obsidian://...">` HTML fragments
 * as React elements with clickable, styled links. Non-link text is rendered as-is.
 *
 * Links use `app.workspace.openLinkText()` for native Obsidian navigation.
 */
function ObsidianLinkText({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(OBSIDIAN_LINK_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before the link
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const href = match[1];
    const linkText = match[2];
    // Extract the file path from the obsidian URI for openLinkText
    const fileParam = new URL(href).searchParams.get("file") ?? "";

    parts.push(
      <a
        key={match.index}
        href={href}
        className="hover:tw-text-interactive-accent tw-cursor-pointer tw-text-accent tw-underline"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          app.workspace.openLinkText(decodeURIComponent(fileParam), "");
        }}
      >
        {linkText}
      </a>
    );

    lastIndex = match.index + match[0].length;
  }

  // No links found — return plain text
  if (parts.length === 0) {
    return <span className={className}>{text}</span>;
  }

  // Remaining text after the last link
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts}</span>;
}

interface ChronicleQuestionCardProps {
  /** The question data */
  question: ChronicleQuestion;
  /** Whether the parent message is still streaming */
  isStreaming?: boolean;
  /** Callback when the user submits an answer */
  onAnswer: (questionId: string, answer: string | string[]) => void;
}

/**
 * Renders an interactive question card embedded in an AI message.
 */
export function ChronicleQuestionCard({
  question,
  isStreaming = false,
  onAnswer,
}: ChronicleQuestionCardProps) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>(() => {
    if (question.isAnswered && question.answer) {
      return Array.isArray(question.answer) ? question.answer : [question.answer];
    }
    return [];
  });
  const [customText, setCustomText] = useState("");
  const [isAnswered, setIsAnswered] = useState(question.isAnswered);
  const [isEditing, setIsEditing] = useState(false);
  const customInputRef = useRef<HTMLTextAreaElement>(null);

  // Sync with external state changes (e.g., loading from history)
  useEffect(() => {
    if (question.isAnswered && !isEditing) {
      setIsAnswered(true);
      if (question.answer) {
        setSelectedOptions(Array.isArray(question.answer) ? question.answer : [question.answer]);
      }
    }
  }, [question.isAnswered, question.answer, isEditing]);

  /**
   * Handle option selection (radio for single-select, checkbox for multi-select).
   */
  const handleOptionToggle = useCallback(
    (option: string) => {
      if (question.multiSelect) {
        setSelectedOptions((prev) =>
          prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
        );
      } else {
        setSelectedOptions([option]);
      }
    },
    [question.multiSelect]
  );

  /**
   * Submit the answer.
   */
  const handleSubmit = useCallback(() => {
    let answer: string | string[];

    // Custom text takes precedence if no options selected, or is appended
    if (customText.trim() && selectedOptions.length === 0) {
      answer = customText.trim();
    } else if (question.multiSelect) {
      const combined = [...selectedOptions];
      if (customText.trim()) {
        combined.push(customText.trim());
      }
      answer = combined;
    } else {
      answer = selectedOptions.length > 0 ? selectedOptions[0] : customText.trim();
    }

    if (!answer || (Array.isArray(answer) && answer.length === 0)) {
      return; // Nothing to submit
    }

    setIsAnswered(true);
    setIsEditing(false);
    onAnswer(question.id, answer);
  }, [selectedOptions, customText, question.id, question.multiSelect, onAnswer]);

  /**
   * Allow re-answering.
   */
  const handleChangeAnswer = useCallback(() => {
    setIsEditing(true);
    setIsAnswered(false);
  }, []);

  const hasAnswer =
    selectedOptions.length > 0 || (question.allowCustom && customText.trim().length > 0);

  // -- Answered State (compact) --
  if (isAnswered && !isEditing) {
    const displayAnswer = Array.isArray(question.answer)
      ? question.answer.join(", ")
      : question.answer || selectedOptions.join(", ");

    return (
      <div className="hendrik-chronicle-question hendrik-chronicle-question--answered tw-my-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-p-3">
        <div className="tw-flex tw-items-start tw-gap-2">
          <Check className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-accent" />
          <div className="tw-flex-1 tw-space-y-1">
            <ObsidianLinkText
              text={question.question}
              className="tw-text-xs tw-font-medium tw-text-muted"
            />
            <div className="tw-text-sm tw-text-normal">{displayAnswer}</div>
          </div>
          <Button
            variant="ghost2"
            size="icon"
            onClick={handleChangeAnswer}
            title="Change answer"
            className="tw-size-6 tw-shrink-0"
          >
            <RotateCcw className="tw-size-3" />
          </Button>
        </div>
      </div>
    );
  }

  // -- Unanswered State (full interactive card) --
  return (
    <div className="hendrik-chronicle-question hendrik-chronicle-question--active tw-my-3 tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-bg-primary tw-border-accent/30">
      {/* Header */}
      <div className="tw-flex tw-items-center tw-gap-2 tw-border-b tw-border-solid tw-border-border tw-bg-primary-alt tw-px-3 tw-py-2">
        <HelpCircle className="tw-size-4 tw-shrink-0 tw-text-accent" />
        <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wider tw-text-accent">
          Chronicle Question
        </span>
      </div>

      {/* Question text */}
      <div className="tw-space-y-3 tw-p-3">
        <ObsidianLinkText
          text={question.question}
          className="tw-text-sm tw-font-medium tw-text-normal"
        />

        {/* Options */}
        {question.options && question.options.length > 0 && (
          <div className="tw-space-y-1.5">
            {question.options.map((option, index) => {
              const isSelected = selectedOptions.includes(option);
              const inputType = question.multiSelect ? "checkbox" : "radio";

              return (
                <label
                  key={`${question.id}-opt-${index}`}
                  className={`tw-flex tw-cursor-pointer tw-items-start tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-px-3 tw-py-2 tw-transition-colors ${
                    isSelected
                      ? "tw-border-accent/50 tw-bg-interactive-accent/10"
                      : "tw-border-border hover:tw-bg-primary-alt"
                  }`}
                >
                  <input
                    type={inputType}
                    name={`chronicle-q-${question.id}`}
                    checked={isSelected}
                    onChange={() => handleOptionToggle(option)}
                    className="tw-accent-interactive-accent tw-mt-0.5 tw-shrink-0"
                    disabled={isStreaming}
                  />
                  <ObsidianLinkText text={option} className="tw-text-sm tw-text-normal" />
                </label>
              );
            })}
          </div>
        )}

        {/* Custom text input */}
        {question.allowCustom && (
          <div className="tw-space-y-1">
            <label className="tw-text-xs tw-text-muted">
              {question.options && question.options.length > 0
                ? "Or provide your own answer:"
                : "Your answer:"}
            </label>
            <textarea
              ref={customInputRef}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Type your response..."
              className="tw-w-full tw-resize-none tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-3 tw-py-2 tw-text-sm tw-text-normal tw-outline-none tw-transition-colors placeholder:tw-text-faint focus:tw-border-accent/50"
              rows={2}
              disabled={isStreaming}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && hasAnswer) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>
        )}

        {/* Submit button */}
        <div className="tw-flex tw-justify-end">
          <Button
            variant="default"
            size="sm"
            onClick={handleSubmit}
            disabled={!hasAnswer || isStreaming}
            className="tw-gap-1.5"
          >
            <Check className="tw-size-3.5" />
            Answer
          </Button>
        </div>
      </div>
    </div>
  );
}
