import * as React from "react";
import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, ChevronDown, ChevronRight, Loader2, RotateCcw, X } from "lucide-react";
import { FailedItem, useProjectContextLoad } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/TruncatedText";
import HendrikPlugin from "@/main";
import { logError } from "@/logger";

interface ProgressCardProps {
  plugin?: HendrikPlugin;
  setHiddenCard: (hidden: boolean) => void;
  onEditContext?: () => void;
}

/**
 * Minimal context-loading progress indicator for project mode.
 * Transparent, borderless design consistent with the chat redesign.
 */
export default function ProgressCard({ plugin, setHiddenCard, onEditContext }: ProgressCardProps) {
  const [contextLoadState] = useProjectContextLoad();
  const totalFiles = contextLoadState.total;
  const successFiles = contextLoadState.success;
  const failedFiles = contextLoadState.failed;
  const processingFiles = contextLoadState.processingFiles;

  const [isProcessingExpanded, setIsProcessingExpanded] = useState(false);
  const [isFailedExpanded, setIsFailedExpanded] = useState(false);

  const processedFilesLen = successFiles.length + failedFiles.length;
  const progressPercentage =
    totalFiles.length > 0 ? Math.round((processedFilesLen / totalFiles.length) * 100) : 0;

  /** @returns Display path for a failed item. */
  const getFailedItemDisplayName = (item: FailedItem): string => {
    return item.path;
  };

  /** Retry a single failed file through the project manager. */
  const handleRetryFailedItem = async (item: FailedItem) => {
    if (!plugin?.projectManager) {
      logError("ProjectManager not available");
      return;
    }

    try {
      await plugin.projectManager.retryFailedItem(item);
    } catch (error) {
      logError(`Error retrying failed item: ${error}`);
    }
  };

  return (
    <div className="hendrik-progress-card">
      {/* Header row */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-medium tw-text-normal">
          <Loader2 className="tw-size-3.5 tw-animate-spin tw-text-muted" />
          Loading context
          {totalFiles.length > 0 && (
            <span className="tw-text-xs tw-font-normal tw-text-faint">
              {processedFilesLen}/{totalFiles.length}
            </span>
          )}
        </div>
        <div className="tw-flex tw-items-center tw-gap-0.5">
          {onEditContext && (
            <Button
              size="sm"
              variant="ghost2"
              className="tw-size-6 tw-p-0 tw-text-faint"
              title="Edit Context"
              onClick={() => onEditContext()}
            >
              <ChevronRight className="tw-size-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost2"
            className="tw-size-6 tw-p-0 tw-text-faint"
            title="Dismiss"
            onClick={() => setHiddenCard(true)}
          >
            <X className="tw-size-3.5" />
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <Progress value={progressPercentage} className="tw-h-1" />

      {/* Currently processing */}
      {processingFiles.length > 0 && (
        <div className="tw-space-y-1">
          <button
            type="button"
            className="tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-border-none tw-bg-transparent tw-p-0.5 tw-text-xs tw-text-muted tw-transition-colors hover:tw-text-normal"
            onClick={() => setIsProcessingExpanded(!isProcessingExpanded)}
          >
            <span className="tw-size-1.5 tw-animate-pulse tw-rounded-full tw-bg-interactive-accent" />
            <span>Processing {processingFiles.length} files</span>
            {isProcessingExpanded ? (
              <ChevronDown className="tw-ml-auto tw-size-3" />
            ) : (
              <ChevronRight className="tw-ml-auto tw-size-3" />
            )}
          </button>

          {isProcessingExpanded && (
            <div className="tw-max-h-24 tw-space-y-0.5 tw-overflow-y-auto tw-pl-3">
              {processingFiles.map((fileName, index) => (
                <div key={index} className="tw-truncate tw-text-xs tw-text-faint">
                  {fileName}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Failed files */}
      {failedFiles.length > 0 && (
        <div className="tw-space-y-1">
          <button
            type="button"
            className="tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-border-none tw-bg-transparent tw-p-0.5 tw-text-xs tw-text-error tw-transition-colors hover:tw-text-error"
            onClick={() => setIsFailedExpanded(!isFailedExpanded)}
          >
            <AlertCircle className="tw-size-3" />
            <span>{failedFiles.length} failed</span>
            {isFailedExpanded ? (
              <ChevronDown className="tw-ml-auto tw-size-3" />
            ) : (
              <ChevronRight className="tw-ml-auto tw-size-3" />
            )}
          </button>

          {isFailedExpanded && (
            <div className="tw-max-h-24 tw-space-y-1 tw-overflow-y-auto tw-pl-3">
              {failedFiles.map((failedItem: FailedItem, index: number) => (
                <div key={index} className="tw-flex tw-items-start tw-gap-2 tw-text-xs">
                  <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-0.5">
                    <TruncatedText
                      className="tw-font-medium tw-text-normal"
                      title={failedItem.path}
                    >
                      {getFailedItemDisplayName(failedItem)}
                    </TruncatedText>
                    {failedItem.error && (
                      <TruncatedText className="tw-text-error/70" title={failedItem.error}>
                        {failedItem.error}
                      </TruncatedText>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost2"
                    className="tw-size-5 tw-shrink-0 tw-p-0"
                    title="Retry"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await handleRetryFailedItem(failedItem);
                    }}
                  >
                    <RotateCcw className="tw-size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
