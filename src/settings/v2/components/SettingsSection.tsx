import React, { useMemo, useState } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useOptionalSettingsSearch } from "@/settings/v2/search/SettingsSearchContext";

interface SettingsSectionProps {
  /** Icon element displayed in the section heading. */
  icon?: React.ReactNode;
  /** Section title. */
  title: string;
  /** Optional section description text. */
  description?: string;
  /** Section content. */
  children: React.ReactNode;
  /** Legacy prop retained for compatibility; no longer applied visually. */
  accentColor?: string;
  /** Whether this section starts expanded. */
  defaultOpen?: boolean;
  /** Whether this section can be collapsed. */
  collapsible?: boolean;
  /** Optional badge rendered beside the heading title. */
  badge?: React.ReactNode;
  /** Extra className for outer section container. */
  className?: string;
  /** Additional section-level search terms. */
  searchTerms?: string[];
  /** Explicitly controls whether this section should render. */
  visible?: boolean;
}

/**
 * Renders a native-style settings section with optional collapse behavior.
 */
export const SettingsSection: React.FC<SettingsSectionProps> = ({
  icon,
  title,
  description,
  children,
  accentColor: _accentColor,
  defaultOpen = true,
  collapsible = false,
  badge,
  className,
  searchTerms,
  visible = true,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const search = useOptionalSettingsSearch();

  const sectionTerms = useMemo(() => {
    const terms: string[] = [title];
    if (description) {
      terms.push(description);
    }
    if (searchTerms && searchTerms.length > 0) {
      terms.push(...searchTerms);
    }
    return terms;
  }, [description, searchTerms, title]);

  const matchesSearch = search?.matches(sectionTerms) ?? true;
  const shouldRender = visible && matchesSearch;

  if (!shouldRender) {
    return null;
  }

  const header = (
    <div
      className={cn(
        "tw-flex tw-items-start tw-justify-between tw-gap-3",
        collapsible && "tw-cursor-pointer tw-select-none"
      )}
      onClick={collapsible ? () => setIsOpen((prev) => !prev) : undefined}
    >
      <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
        {icon && (
          <span className="tw-mt-0.5 tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center tw-text-muted">
            {icon}
          </span>
        )}
        <div className="tw-min-w-0">
          <h2 className="tw-m-0 tw-text-base tw-font-semibold tw-leading-tight tw-text-normal">
            {title}
          </h2>
          {description && (
            <p className="tw-m-0 tw-mt-1 tw-text-xs tw-leading-relaxed tw-text-muted">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="tw-flex tw-items-center tw-gap-2">
        {badge}
        {collapsible && (
          <span className="tw-text-muted">
            {isOpen ? (
              <ChevronDown className="tw-size-4" />
            ) : (
              <ChevronRight className="tw-size-4" />
            )}
          </span>
        )}
      </div>
    </div>
  );

  const body = (
    <div className="tw-mt-2 tw-border-t tw-border-border">
      <div className="hendrik-settings-section__items">{children}</div>
    </div>
  );

  return (
    <section className={cn("tw-space-y-2", className)}>
      {header}
      {collapsible ? (
        <Collapsible open={isOpen}>
          <CollapsibleContent>{body}</CollapsibleContent>
        </Collapsible>
      ) : (
        body
      )}
    </section>
  );
};
