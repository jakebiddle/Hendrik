import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useChatInput } from "@/context/ChatInputContext";
import { PlusCircle } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface NotePrompt {
  title: string;
  prompts: string[];
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

function getRandomPrompt(chainType: ChainType = ChainType.TOOL_CALLING_CHAIN) {
  const keys = PROMPT_KEYS[chainType] || PROMPT_KEYS[ChainType.TOOL_CALLING_CHAIN];

  // For repeated keys, shuffle once and take multiple items
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

export const SuggestedPrompts: React.FC = () => {
  const [chainType] = useChainType();
  const prompts = useMemo(() => getRandomPrompt(chainType), [chainType]);
  const chatInput = useChatInput();

  /**
   * Inserts the selected prompt directly into the composer using the Lexical command path.
   * This keeps editor state and external React state synchronized.
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
    <div className="copilot-suggested-prompts tw-flex tw-flex-col tw-gap-4">
      <Card className="tw-w-full tw-bg-transparent">
        <CardHeader className="tw-px-2">
          <CardTitle>Suggested Prompts</CardTitle>
        </CardHeader>
        <CardContent className="tw-p-2 tw-pt-0">
          <div className="tw-flex tw-flex-col tw-gap-2">
            {prompts.map((prompt, i) => (
              <div
                key={i}
                className="tw-flex tw-justify-between tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-2 tw-text-sm"
              >
                <div className="tw-flex tw-flex-col tw-gap-1">
                  <div className="tw-text-muted">{prompt.title}</div>
                  <div>{prompt.text}</div>
                </div>
                <div className="tw-flex tw-h-full tw-items-start">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost2"
                        size="fit"
                        className="tw-text-muted"
                        onClick={() => handleAddPromptToChat(prompt.text)}
                      >
                        <PlusCircle className="tw-size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Add to Chat</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
