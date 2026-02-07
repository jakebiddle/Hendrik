import React from "react";
import { MessageSquare, MousePointerClick, Terminal } from "lucide-react";

interface ExplainerCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  accentColor: string;
}

/** Single explainer card showing one way to use commands */
const ExplainerCard: React.FC<ExplainerCardProps> = ({ icon, title, description, accentColor }) => (
  <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-border tw-p-4 tw-text-center tw-bg-secondary/30">
    <div
      className="tw-flex tw-size-10 tw-items-center tw-justify-center tw-rounded-full"
      style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)` }}
    >
      <div className="tw-size-5" style={{ color: accentColor }}>
        {icon}
      </div>
    </div>
    <div className="tw-text-sm tw-font-medium">{title}</div>
    <div className="tw-text-xs tw-leading-relaxed tw-text-muted">{description}</div>
  </div>
);

/**
 * Visual explainer showing the 3 ways to use custom commands in Hendrik.
 * Displayed at the top of the Commands settings tab.
 */
export const CommandExplainer: React.FC = () => {
  return (
    <div className="tw-space-y-3">
      <div>
        <h3 className="tw-text-lg tw-font-semibold">What Are Custom Commands?</h3>
        <p className="tw-mt-1 tw-text-sm tw-text-muted">
          Custom commands are preset prompts you can trigger in three ways:
        </p>
      </div>

      <div className="tw-grid tw-grid-cols-1 tw-gap-3 sm:tw-grid-cols-3">
        <ExplainerCard
          icon={<MousePointerClick className="tw-size-5" />}
          title="Right-Click Menu"
          description="Select text in your note, right-click, and pick a command to run it on your selection."
          accentColor="var(--color-blue)"
        />
        <ExplainerCard
          icon={<MessageSquare className="tw-size-5" />}
          title="Slash Commands"
          description="Type / in the chat input to browse and load a pre-made prompt into your conversation."
          accentColor="var(--color-green)"
        />
        <ExplainerCard
          icon={<Terminal className="tw-size-5" />}
          title="Command Palette"
          description="Use Obsidian's command palette (Ctrl/Cmd+P) to trigger any enabled command."
          accentColor="var(--color-purple)"
        />
      </div>
    </div>
  );
};
