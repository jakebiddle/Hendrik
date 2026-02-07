import { UserSystemPrompt } from "@/system-prompts/type";

export const EMPTY_SYSTEM_PROMPT: UserSystemPrompt = {
  title: "",
  content: "",
  createdMs: 0,
  modifiedMs: 0,
  lastUsedMs: 0,
};

// System prompt frontmatter property constants
export const HENDRIK_SYSTEM_PROMPT_CREATED = "hendrik-system-prompt-created";
export const HENDRIK_SYSTEM_PROMPT_MODIFIED = "hendrik-system-prompt-modified";
export const HENDRIK_SYSTEM_PROMPT_LAST_USED = "hendrik-system-prompt-last-used";
export const HENDRIK_SYSTEM_PROMPT_DEFAULT = "hendrik-system-prompt-default";
