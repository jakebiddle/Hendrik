import React from "react";
import { createRoot, Root } from "react-dom/client";

import { ChronicleQuestionCard } from "@/components/chat-components/ChronicleQuestionCard";
import type { ChronicleQuestion } from "@/types/chronicleQuestion";
import { logWarn } from "@/logger";

// ---------------------------------------------------------------------------
// Global window registry (survives React component lifecycle)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __hendrikChronicleQuestionRoots?: Map<string, Map<string, ChronicleQuestionRootRecord>>;
  }
}

export interface ChronicleQuestionRootRecord {
  root: Root;
  isUnmounting: boolean;
  /** Reference to the DOM container to detect container changes */
  container: HTMLElement;
}

const STALE_ROOT_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Retrieve the global registry for chronicle question React roots.
 */
const getRegistry = (): Map<string, Map<string, ChronicleQuestionRootRecord>> => {
  if (!window.__hendrikChronicleQuestionRoots) {
    window.__hendrikChronicleQuestionRoots = new Map();
  }
  return window.__hendrikChronicleQuestionRoots;
};

/**
 * Remove the message entry from the registry when it has no active roots.
 */
const pruneEmptyMessageEntry = (
  messageId: string,
  messageRoots: Map<string, ChronicleQuestionRootRecord>
): void => {
  if (messageRoots.size > 0) return;
  const registry = getRegistry();
  const currentRoots = registry.get(messageId);
  if (currentRoots === messageRoots) {
    registry.delete(messageId);
  }
};

/**
 * Unmount a chronicle question root, mark it as inactive, and remove it from the registry.
 */
const disposeRoot = (
  messageId: string,
  messageRoots: Map<string, ChronicleQuestionRootRecord>,
  questionId: string,
  record: ChronicleQuestionRootRecord,
  logContext: string
): void => {
  try {
    record.root.unmount();
  } catch (error) {
    logWarn(`Error unmounting chronicle question root during ${logContext}`, questionId, error);
  }
  record.isUnmounting = false;
  if (messageRoots.get(questionId) === record) {
    messageRoots.delete(questionId);
  }
  pruneEmptyMessageEntry(messageId, messageRoots);
};

/**
 * Handle container change — immediately remove old record and schedule deferred unmount.
 */
const handleContainerChange = (
  messageId: string,
  messageRoots: Map<string, ChronicleQuestionRootRecord>,
  questionId: string,
  oldRecord: ChronicleQuestionRootRecord,
  logContext: string
): void => {
  messageRoots.delete(questionId);
  oldRecord.isUnmounting = true;
  setTimeout(() => {
    try {
      oldRecord.root.unmount();
    } catch (error) {
      logWarn(`Error unmounting chronicle question root during ${logContext}`, questionId, error);
    }
    oldRecord.isUnmounting = false;
    pruneEmptyMessageEntry(messageId, messageRoots);
  }, 0);
};

/**
 * Schedule a deferred unmount for a chronicle question root.
 */
const scheduleDisposal = (
  messageId: string,
  messageRoots: Map<string, ChronicleQuestionRootRecord>,
  questionId: string,
  record: ChronicleQuestionRootRecord,
  logContext: string
): void => {
  if (record.isUnmounting) return;
  record.isUnmounting = true;

  setTimeout(() => {
    const registry = getRegistry();
    const currentRoots = registry.get(messageId);
    const currentRecord = currentRoots?.get(questionId);
    if (!currentRoots || currentRecord !== record) {
      record.isUnmounting = false;
      pruneEmptyMessageEntry(messageId, messageRoots);
      return;
    }
    disposeRoot(messageId, currentRoots, questionId, currentRecord, logContext);
  }, 0);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure a React root exists for the provided chronicle question container.
 */
export const ensureChronicleQuestionRoot = (
  messageId: string,
  messageRoots: Map<string, ChronicleQuestionRootRecord>,
  questionId: string,
  container: HTMLElement,
  logContext: string
): ChronicleQuestionRootRecord => {
  let record = messageRoots.get(questionId);

  if (record?.isUnmounting) {
    disposeRoot(messageId, messageRoots, questionId, record, `${logContext} (finalizing stale)`);
    record = undefined;
  }

  if (record && record.container && record.container !== container) {
    handleContainerChange(
      messageId,
      messageRoots,
      questionId,
      record,
      `${logContext} (container changed)`
    );
    record = undefined;
  }

  if (!record) {
    record = {
      root: createRoot(container),
      isUnmounting: false,
      container,
    };
    messageRoots.set(questionId, record);
  }

  return record;
};

/**
 * Render a `ChronicleQuestionCard` into the provided root record.
 */
export const renderChronicleQuestionCard = (
  record: ChronicleQuestionRootRecord,
  question: ChronicleQuestion,
  isStreaming: boolean,
  onAnswer: (questionId: string, answer: string | string[]) => void
): void => {
  record.root.render(
    <ChronicleQuestionCard question={question} isStreaming={isStreaming} onAnswer={onAnswer} />
  );
};

/**
 * Schedule the removal of a chronicle question root.
 */
export const removeChronicleQuestionRoot = (
  messageId: string,
  messageRoots: Map<string, ChronicleQuestionRootRecord>,
  questionId: string,
  logContext: string
): void => {
  const record = messageRoots.get(questionId);
  if (!record) return;
  scheduleDisposal(messageId, messageRoots, questionId, record, logContext);
};

/**
 * Return (and create if necessary) the chronicle question root map for a message.
 */
export const getMessageChronicleQuestionRoots = (
  messageId: string
): Map<string, ChronicleQuestionRootRecord> => {
  const registry = getRegistry();
  let messageRoots = registry.get(messageId);
  if (!messageRoots) {
    messageRoots = new Map();
    registry.set(messageId, messageRoots);
  }
  return messageRoots;
};

/**
 * Clean up chronicle question roots that are no longer attached to the DOM.
 */
export const cleanupStaleChronicleQuestionRoots = (now: number = Date.now()): void => {
  const registry = getRegistry();
  registry.forEach((messageRoots, messageId) => {
    messageRoots.forEach((record, questionId) => {
      if (record.container) {
        if (record.container.isConnected) return;
        scheduleDisposal(
          messageId,
          messageRoots,
          questionId,
          record,
          "stale cleanup (detached container)"
        );
        return;
      }
      const timestamp = Number.parseInt(messageId, 10);
      if (Number.isNaN(timestamp) || now - timestamp < STALE_ROOT_MAX_AGE_MS) return;
      scheduleDisposal(messageId, messageRoots, questionId, record, "stale cleanup (legacy)");
    });
  });
};

/**
 * Schedule cleanup for all chronicle question roots owned by a specific message.
 */
export const cleanupMessageChronicleQuestionRoots = (
  messageId: string,
  messageRoots: Map<string, ChronicleQuestionRootRecord>,
  logContext: string
): void => {
  messageRoots.forEach((record, questionId) => {
    scheduleDisposal(messageId, messageRoots, questionId, record, logContext);
  });
};
