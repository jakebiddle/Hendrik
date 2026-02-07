import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ContextPressureIndicatorProps {
  tokenCount: number | null;
  maxContextTokens: number | null;
  show: boolean;
}

/**
 * Displays context pressure for the latest response versus the model context window.
 */
export const ContextPressureIndicator: React.FC<ContextPressureIndicatorProps> = ({
  tokenCount,
  maxContextTokens,
  show,
}) => {
  if (!show || !maxContextTokens || maxContextTokens <= 0) {
    return null;
  }

  const hasUsage = typeof tokenCount === "number" && tokenCount >= 0;
  const usage = hasUsage ? Math.min(tokenCount, maxContextTokens) : 0;
  const ratio = hasUsage ? Math.min(usage / maxContextTokens, 1) : 0;
  const percent = hasUsage ? Math.round(ratio * 100) : null;

  /**
   * Resolve the indicator bar color from the current pressure ratio.
   */
  const getBarClass = (): string => {
    if (!hasUsage) return "tw-bg-muted";
    if (ratio >= 0.85) return "tw-bg-rose-500";
    if (ratio >= 0.6) return "tw-bg-amber-500";
    return "tw-bg-emerald-500";
  };

  const tooltipText = hasUsage
    ? `Context pressure: ${tokenCount.toLocaleString()} / ${maxContextTokens.toLocaleString()} tokens`
    : "Context pressure unavailable (no token usage reported).";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-faint">
          <div className="tw-bg-muted tw-h-1 tw-w-10 tw-overflow-hidden tw-rounded-full">
            <div className={`tw-h-full ${getBarClass()}`} style={{ width: `${percent ?? 0}%` }} />
          </div>
          <span>{percent === null ? "n/a" : `${percent}%`}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
};
