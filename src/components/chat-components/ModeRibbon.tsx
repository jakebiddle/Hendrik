import { ChainType } from "@/chainFactory";
import { cn } from "@/lib/utils";
import { Brain, LibraryBig } from "lucide-react";
import React from "react";

interface ModeRibbonProps {
  selectedChain: ChainType;
  onSelectAgent: () => void;
  onSelectProjects: () => void;
}

interface RibbonButtonProps {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

/**
 * Accessible mode switch button used by the left ribbon.
 */
function RibbonButton({ active, label, icon, onClick }: RibbonButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn("hendrik-mode-ribbon__button", active && "hendrik-mode-ribbon__button--active")}
      onClick={onClick}
      title={label}
    >
      <span className="hendrik-mode-ribbon__button-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="hendrik-mode-ribbon__button-label">{label}</span>
    </button>
  );
}

/**
 * Vertical mode switch rail for Agent and Projects chat contexts.
 */
export function ModeRibbon({
  selectedChain,
  onSelectAgent,
  onSelectProjects,
}: ModeRibbonProps): React.ReactElement {
  const inProjectMode = selectedChain === ChainType.PROJECT_CHAIN;

  return (
    <aside className="hendrik-mode-ribbon" aria-label="Mode switcher">
      <div className="hendrik-mode-ribbon__inner">
        <div className="hendrik-mode-ribbon__buttons" role="tablist" aria-label="Chat modes">
          <RibbonButton
            active={!inProjectMode}
            label="Agent"
            icon={<Brain className="tw-size-4" />}
            onClick={onSelectAgent}
          />
          <RibbonButton
            active={inProjectMode}
            label="Projects"
            icon={<LibraryBig className="tw-size-4" />}
            onClick={onSelectProjects}
          />
        </div>
      </div>
    </aside>
  );
}
