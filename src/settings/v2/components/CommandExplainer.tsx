import React from "react";
import { BookOpen } from "lucide-react";
import { SettingsSection } from "@/settings/v2/components/SettingsSection";

/**
 * Brief usage guidance for custom commands.
 */
export const CommandExplainer: React.FC = () => {
  return (
    <SettingsSection
      icon={<BookOpen className="tw-size-4" />}
      title="Command Usage"
      description="Ways to run custom commands."
      searchTerms={["Right-Click Menu", "Slash Commands", "Command Palette"]}
    >
      <div className="tw-space-y-2 tw-py-3 tw-text-sm tw-text-muted">
        <div>
          <strong className="tw-text-normal">Right-Click Menu:</strong> Run a command on selected
          editor text.
        </div>
        <div>
          <strong className="tw-text-normal">Slash Commands:</strong> Type <code>/</code> in chat to
          insert a command prompt.
        </div>
        <div>
          <strong className="tw-text-normal">Command Palette:</strong> Run enabled commands from
          Obsidian command search.
        </div>
      </div>
    </SettingsSection>
  );
};
