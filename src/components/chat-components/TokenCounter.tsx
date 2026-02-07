import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import React from "react";

interface TokenCounterProps {
  tokenCount: number | null;
}

/**
 * Converts raw token counts into a compact display string.
 */
function formatTokenCount(count: number): string {
  if (count < 1000) {
    return "<1k";
  }

  if (count < 1_000_000) {
    return `${Math.round(count / 1000)}k`;
  }

  return `${(count / 1_000_000).toFixed(1)}m`;
}

/**
 * Compact inline token counter. Shows formatted count as a subtle label.
 */
export const TokenCounter: React.FC<TokenCounterProps> = ({ tokenCount }) => {
  if (tokenCount === null || tokenCount === undefined) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="copilot-token-counter" aria-label="Token usage">
          {formatTokenCount(tokenCount)} tokens
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Context used: {tokenCount.toLocaleString()} tokens
      </TooltipContent>
    </Tooltip>
  );
};
