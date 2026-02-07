import React from "react";
import { cn } from "@/lib/utils";

type StatusType = "active" | "inactive" | "warning" | "error";

interface StatusIndicatorProps {
  /** Status type controls the color */
  status: StatusType;
  /** Text label displayed next to the dot */
  label: string;
  /** Additional className */
  className?: string;
}

const statusStyles: Record<StatusType, { dot: string; bg: string; text: string }> = {
  active: {
    dot: "tw-bg-[var(--color-green)]",
    bg: "tw-bg-[rgba(var(--color-green-rgb),0.08)]",
    text: "tw-text-[var(--color-green)]",
  },
  inactive: {
    dot: "tw-bg-[var(--color-base-50)]",
    bg: "tw-bg-secondary",
    text: "tw-text-muted",
  },
  warning: {
    dot: "tw-bg-[var(--color-yellow)]",
    bg: "tw-bg-[rgba(var(--color-yellow-rgb),0.08)]",
    text: "tw-text-[var(--color-yellow)]",
  },
  error: {
    dot: "tw-bg-[var(--color-red)]",
    bg: "tw-bg-[rgba(var(--color-red-rgb),0.08)]",
    text: "tw-text-[var(--color-red)]",
  },
};

/**
 * Small status pill with a colored dot and text label.
 * Used for showing connection status, API key status, etc.
 */
export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, label, className }) => {
  const styles = statusStyles[status];

  return (
    <span
      className={cn(
        "tw-inline-flex tw-items-center tw-gap-1.5",
        "tw-rounded-full tw-px-2.5 tw-py-0.5",
        "tw-text-xs tw-font-medium",
        styles.bg,
        styles.text,
        className
      )}
    >
      <span className={cn("tw-size-1.5 tw-shrink-0 tw-rounded-full", styles.dot)} />
      {label}
    </span>
  );
};
