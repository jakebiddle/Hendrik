import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { useChatInput } from "@/context/ChatInputContext";
import { PlusCircle } from "lucide-react";
import React, { useCallback, useMemo } from "react";

interface NotePrompt {
  title: string;
  prompts: string[];
}

interface SuggestedPromptsProps {
  title?: string;
  maxItems?: number;
}

const SUGGESTED_PROMPTS: Record<string, NotePrompt> = {
  activeNote: {
    title: "Active Note Insights",
    prompts: [
      `Provide three follow-up questions worded as if I'm asking you based on {activeNote}?`,
      `What key questions does {activeNote} answer?`,
      `Give me a quick recap of {activeNote} in two sentences.`,
    ],
  },
  quoteNote: {
    title: "Note Link Chat",
    prompts: [
      `Based on [[<note>]], what improvements should we focus on next?`,
      `Summarize the key points from [[<note>]].`,
      `Summarize the recent updates from [[<note>]].`,
      `Roast my writing in [[<note>]] and give concrete actionable feedback`,
    ],
  },
  fun: {
    title: "Test LLM",
    prompts: [
      `9.11 and 9.8, which is bigger?`,
      `What's the longest river in the world?`,
      `If a lead ball and a feather are dropped simultaneously from the same height, which will reach the ground first?`,
    ],
  },
  qaVault: {
    title: "Vault Q&A",
    prompts: [
      `What insights can I gather about <topic> from my notes?`,
      `Explain <concept> based on my stored notes.`,
      `Highlight important details on <topic> from my notes.`,
      `Based on my notes on <topic>, what is the question that I should be asking, but am not?`,
    ],
  },
  copilotPlus: {
    title: "Hendrik",
    prompts: [
      `Give me a recap of last week @vault`,
      `What are the key takeaways from my notes on <topic> @vault`,
      `Summarize <url> in under 10 bullet points`,
      `Summarize <youtube_video_url>`,
      `@websearch what are most recent updates in the AI industry`,
      `What are the key insights from this paper <arxiv_url>`,
      `What new methods are proposed in this paper [[<note_with_embedded_pdf>]]`,
    ],
  },
};

const PROMPT_KEYS: Record<ChainType, Array<keyof typeof SUGGESTED_PROMPTS>> = {
  [ChainType.LLM_CHAIN]: ["copilotPlus", "copilotPlus", "copilotPlus"],
  [ChainType.VAULT_QA_CHAIN]: ["copilotPlus", "copilotPlus", "copilotPlus"],
  [ChainType.TOOL_CALLING_CHAIN]: ["copilotPlus", "copilotPlus", "copilotPlus"],
  [ChainType.PROJECT_CHAIN]: ["copilotPlus", "copilotPlus", "copilotPlus"],
};

/**
 * Returns a randomized list of prompts for the current chain.
 */
function getRandomPrompt(chainType: ChainType = ChainType.TOOL_CALLING_CHAIN) {
  const keys = PROMPT_KEYS[chainType] || PROMPT_KEYS[ChainType.TOOL_CALLING_CHAIN];
  const shuffledPrompts: Record<string, string[]> = {};

  return keys.map((key) => {
    if (!shuffledPrompts[key]) {
      shuffledPrompts[key] = [...SUGGESTED_PROMPTS[key].prompts].sort(() => Math.random() - 0.5);
    }
    return {
      title: SUGGESTED_PROMPTS[key].title,
      text: shuffledPrompts[key].pop() || SUGGESTED_PROMPTS[key].prompts[0],
    };
  });
}

export const SuggestedPrompts: React.FC<SuggestedPromptsProps> = ({
  title = "Suggested prompts",
  maxItems = 3,
}) => {
  const [chainType] = useChainType();
  const prompts = useMemo(
    () => getRandomPrompt(chainType).slice(0, maxItems),
    [chainType, maxItems]
  );
  const chatInput = useChatInput();

  /**
   * Inserts the selected prompt through the shared Lexical insertion pathway.
   */
  const handleAddPromptToChat = useCallback(
    (text: string) => {
      chatInput.focusInput();
      window.requestAnimationFrame(() => {
        chatInput.insertTextWithPills(text, true);
      });
    },
    [chatInput]
  );

  return (
    <section className="copilot-suggested-prompts">
      <div className="copilot-suggested-prompts__title">{title}</div>
      <div className="copilot-suggested-prompts__list">
        {prompts.map((prompt, i) => (
          <button
            key={`${prompt.title}-${i}`}
            type="button"
            className="copilot-suggested-prompts__pill"
            onClick={() => handleAddPromptToChat(prompt.text)}
            title={prompt.text}
          >
            <span className="copilot-suggested-prompts__pill-text">{prompt.text}</span>
            <PlusCircle className="copilot-suggested-prompts__pill-icon" />
          </button>
        ))}
      </div>
    </section>
  );
};
