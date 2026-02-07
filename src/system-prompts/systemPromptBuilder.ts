import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { getSettings } from "@/settings/model";
import { DEFAULT_SYSTEM_PROMPT } from "@/constants";
import { logInfo } from "@/logger";
import {
  getDisableBuiltinSystemPrompt,
  getEffectiveSystemPromptContent,
} from "@/system-prompts/state";

/**
 * Build a personalization block from user settings.
 * Returns an empty string if no personalization is configured.
 */
function buildPersonalizationBlock(): string {
  const settings = getSettings();
  const lines: string[] = [];

  // Preferred name
  const name = settings.userPreferredName?.trim();
  if (name) {
    lines.push(`- The user's name is "${name}". Address them by name when appropriate.`);
  }

  // Response tone
  const toneDescriptions: Record<string, string> = {
    formal: "Use a professional and formal tone. Be polished and precise.",
    conversational: "Use a warm, conversational tone. Be friendly and approachable.",
    concise: "Be concise and to-the-point. Minimize filler and unnecessary elaboration.",
    detailed:
      "Provide detailed, thorough responses with explanations and context. Be comprehensive.",
  };
  const tone = settings.responseTone;
  if (tone && tone !== "conversational" && toneDescriptions[tone]) {
    lines.push(`- ${toneDescriptions[tone]}`);
  }

  // Response length
  const lengthDescriptions: Record<string, string> = {
    brief: "Keep responses brief — aim for short, focused answers.",
    standard: "", // default, no instruction needed
    thorough:
      "Provide thorough, in-depth responses. Expand on topics and include relevant details.",
  };
  const length = settings.responseLength;
  if (length && lengthDescriptions[length]) {
    lines.push(`- ${lengthDescriptions[length]}`);
  }

  // Expertise level
  const expertiseDescriptions: Record<string, string> = {
    beginner:
      "The user is a beginner. Use simple language, explain jargon, and provide step-by-step guidance.",
    intermediate: "", // default, no instruction needed
    expert:
      "The user is an expert. Skip basic explanations, use technical terminology freely, and focus on advanced details.",
  };
  const expertise = settings.expertiseLevel;
  if (expertise && expertiseDescriptions[expertise]) {
    lines.push(`- ${expertiseDescriptions[expertise]}`);
  }

  // Preferred language
  const language = settings.preferredLanguage?.trim();
  if (language) {
    lines.push(`- Always respond in ${language} unless the user explicitly asks otherwise.`);
  }

  if (lines.length === 0) {
    return "";
  }

  return `\n<user_personalization>\n${lines.join("\n")}\n</user_personalization>`;
}

/**
 * Get the effective user custom prompt with legacy fallback.
 * This is the single source of truth for user prompt content.
 *
 * Priority: file-based (session override > global default) > legacy setting > ""
 *
 * @returns The user custom prompt content
 */
export function getEffectiveUserPrompt(): string {
  const fileBasedUserPrompt = getEffectiveSystemPromptContent();

  // Fallback: if file-based prompts are unavailable (e.g. migration failed to write files),
  // continue honoring the legacy settings field to fulfill the promise in migration error message.
  return fileBasedUserPrompt || getSettings()?.userSystemPrompt || "";
}

/**
 * Build the complete system prompt for the current session.
 * Combines builtin prompt with user custom instructions.
 *
 * Priority for user prompt: session override > global default > legacy setting fallback > ""
 *
 * @returns The complete system prompt string
 */
export function getSystemPrompt(): string {
  const userPrompt = getEffectiveUserPrompt();
  const personalization = buildPersonalizationBlock();

  // Check if builtin prompt is disabled for current session
  const disableBuiltin = getDisableBuiltinSystemPrompt();

  if (disableBuiltin) {
    // Only return user custom prompt + personalization
    return personalization ? `${userPrompt}${personalization}` : userPrompt;
  }

  // Default behavior: use builtin prompt
  const basePrompt = DEFAULT_SYSTEM_PROMPT;

  let prompt = basePrompt;

  if (personalization) {
    prompt = `${prompt}${personalization}`;
  }

  if (userPrompt) {
    prompt = `${prompt}\n<user_custom_instructions>\n${userPrompt}\n</user_custom_instructions>`;
  }

  return prompt;
}

/**
 * Build system prompt with user memory prefix.
 * Memory content is prepended to the system prompt if available.
 *
 * @param userMemoryManager - Optional memory manager to fetch user memory
 * @returns The complete system prompt with memory prefix
 */
export async function getSystemPromptWithMemory(
  userMemoryManager: UserMemoryManager | undefined
): Promise<string> {
  const systemPrompt = getSystemPrompt();

  if (!userMemoryManager) {
    logInfo("No UserMemoryManager provided to getSystemPromptWithMemory");
    return systemPrompt;
  }
  const memoryPrompt = await userMemoryManager.getUserMemoryPrompt();

  // Only include user_memory section if there's actual memory content
  if (!memoryPrompt) {
    return systemPrompt;
  }

  return `${memoryPrompt}\n${systemPrompt}`;
}
