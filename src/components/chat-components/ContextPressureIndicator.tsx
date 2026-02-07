import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ContextPressureIndicatorProps {
  tokenCount: number | null;
  maxContextTokens: number | null;
  show: boolean;
}

/**
 * Compact inline context pressure indicator.
 * Shows pressure as a small colored dot + percentage for a clean, minimal look.
 */
export const ContextPressureIndicator: React.FC<ContextPressureIndicatorProps> = ({
  tokenCount,
  maxContextTokens,
  show,
}) => {
  if (!show || !maxContextTokens || maxContextTokens <= 0 || tokenCount === null) {
    return null;
  }

  const usage = Math.min(Math.max(tokenCount, 0), maxContextTokens);
  const ratio = Math.min(usage / maxContextTokens, 1);
  const percent = Math.round(ratio * 100);

  /**
   * Resolves dot color class from pressure ratio.
   */
  const getDotClass = (): string => {
    if (ratio >= 0.85) {
      return "hendrik-context-pressure__dot--high";
    }

    if (ratio >= 0.6) {
      return "hendrik-context-pressure__dot--medium";
    }

    return "hendrik-context-pressure__dot--low";
  };

  const tooltipText = `Context: ${tokenCount.toLocaleString()} / ${maxContextTokens.toLocaleString()} tokens (${percent}%)`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="hendrik-context-pressure" aria-label={tooltipText}>
          <span className={`hendrik-context-pressure__dot ${getDotClass()}`} aria-hidden="true" />
          <span className="hendrik-context-pressure__value">{percent}%</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltipText}</TooltipContent>
    </Tooltip>
  );
};
