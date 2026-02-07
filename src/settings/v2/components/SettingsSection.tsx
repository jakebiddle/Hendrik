import React, { useState } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SettingsSectionProps {
  /** Icon element displayed in the section header */
  icon: React.ReactNode;
  /** Section title */
  title: string;
  /** Optional description text below the title */
  description?: string;
  /** Section content (SettingItems, etc.) */
  children: React.ReactNode;
  /** CSS color value for the left accent border (e.g., "var(--color-blue)") */
  accentColor?: string;
  /** Whether this section starts expanded (default: true) */
  defaultOpen?: boolean;
  /** Whether this section can be collapsed */
  collapsible?: boolean;
  /** Optional badge/status element displayed in the header */
  badge?: React.ReactNode;
  /** Additional className for the outer container */
  className?: string;
}

/**
 * Reusable settings section card with colored left border accent, icon header,
 * optional collapse behavior, and optional status badge.
 */
export const SettingsSection: React.FC<SettingsSectionProps> = ({
  icon,
  title,
  description,
  children,
  accentColor = "var(--interactive-accent)",
  defaultOpen = true,
  collapsible = false,
  badge,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const hasDescription = Boolean(description);

  const headerContent = (
    <div
      className={cn(
        "tw-grid tw-grid-cols-[auto,1fr,auto] tw-gap-3 tw-rounded-t-lg tw-px-4 tw-py-3.5",
        hasDescription ? "tw-items-start" : "tw-items-center",
        collapsible && "tw-cursor-pointer tw-select-none"
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${accentColor} 5%, var(--background-primary))`,
        borderBottom: "1px solid var(--hendrik-border-soft)",
      }}
      onClick={collapsible ? () => setIsOpen((prev) => !prev) : undefined}
    >
      {/* Icon */}
      <div
        className={cn(
          "tw-flex tw-size-7 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-solid",
          hasDescription && "tw-mt-0.5"
        )}
        style={{
          color: accentColor,
          backgroundColor: `color-mix(in srgb, ${accentColor} 15%, var(--background-primary))`,
          borderColor: `color-mix(in srgb, ${accentColor} 30%, var(--background-modifier-border))`,
        }}
      >
        {icon}
      </div>

      {/* Title and description */}
      <div className="tw-min-w-0 tw-flex-1">
        <div className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-2">
          <h3 className="tw-text-[13px] tw-font-semibold tw-leading-tight tw-text-normal">
            {title}
          </h3>
        </div>
        {description && (
          <p className="tw-mt-0.5 tw-pr-2 tw-text-[11px] tw-leading-5 tw-text-muted">
            {description}
          </p>
        )}
      </div>

      {/* Badge + collapse indicator */}
      {(badge || collapsible) && (
        <div
          className={cn(
            "tw-flex tw-items-center tw-gap-2 tw-justify-self-end",
            hasDescription && "tw-pt-0.5"
          )}
        >
          {badge}
          {collapsible && (
            <div className="tw-text-muted">
              {isOpen ? (
                <ChevronDown className="tw-size-4" />
              ) : (
                <ChevronRight className="tw-size-4" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const bodyContent = (
    <div className="tw-px-4 tw-pb-4 tw-pt-0">
      <div className="tw-divide-y tw-divide-border">{children}</div>
    </div>
  );

  return (
    <section
      className={cn(
        "tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-bg-primary",
        "tw-shadow-sm",
        className
      )}
      style={{
        borderColor: `color-mix(in srgb, ${accentColor} 15%, var(--hendrik-border-soft))`,
      }}
    >
      {headerContent}

      {collapsible ? (
        <Collapsible open={isOpen}>
          <CollapsibleContent>{bodyContent}</CollapsibleContent>
        </Collapsible>
      ) : (
        bodyContent
      )}
    </section>
  );
};
