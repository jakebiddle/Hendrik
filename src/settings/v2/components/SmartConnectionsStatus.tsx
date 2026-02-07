import React, { useEffect, useState } from "react";
import { isSmartConnectionsAvailable } from "@/search/smartConnectionsRetriever";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle } from "lucide-react";

interface SmartConnectionsStatusProps {
  /** Whether the Smart Connections toggle is enabled */
  enabled: boolean;
}

/**
 * Inline status banner that shows whether Smart Connections plugin
 * is detected and available for semantic search queries.
 */
export const SmartConnectionsStatus: React.FC<SmartConnectionsStatusProps> = ({ enabled }) => {
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    if (enabled) {
      setIsAvailable(isSmartConnectionsAvailable(app));
    }
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      className={cn(
        "tw-flex tw-items-center tw-gap-2.5 tw-rounded-md tw-border tw-p-3 tw-text-sm",
        isAvailable
          ? "tw-border-[rgba(var(--color-green-rgb),0.3)] tw-bg-[rgba(var(--color-green-rgb),0.05)]"
          : "tw-border-[rgba(var(--color-red-rgb),0.3)] tw-bg-[rgba(var(--color-red-rgb),0.05)]"
      )}
    >
      {isAvailable ? (
        <>
          <CheckCircle2 className="tw-size-4 tw-shrink-0 tw-text-[var(--color-green)]" />
          <div>
            <div className="tw-font-medium tw-text-[var(--color-green)]">
              Smart Connections Detected
            </div>
            <div className="tw-text-xs tw-text-muted">Plugin is active and ready for queries</div>
          </div>
        </>
      ) : (
        <>
          <XCircle className="tw-size-4 tw-shrink-0 tw-text-[var(--color-red)]" />
          <div>
            <div className="tw-font-medium tw-text-[var(--color-red)]">
              Smart Connections Not Found
            </div>
            <div className="tw-text-xs tw-text-muted">
              Install and enable the Smart Connections plugin
            </div>
          </div>
        </>
      )}
    </div>
  );
};
