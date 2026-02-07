import {
  resolvePresenceLine,
  resolveRoyalAddress,
} from "@/components/chat-components/companionTone";
import { useActiveNoteInsight } from "@/components/chat-components/hooks/useActiveNoteInsight";
import { useSettingsValue } from "@/settings/model";
import React, { useMemo } from "react";

interface ArchivistGreetingProps {
  isGenerating: boolean;
  hasMessages: boolean;
  latestUserMessage?: string | null;
}

/**
 * Compact companion presence strip shown during active conversation.
 * Inline layout: avatar + name/status on one tight row.
 */
export function ArchivistGreeting({
  isGenerating,
  hasMessages,
  latestUserMessage,
}: ArchivistGreetingProps) {
  const settings = useSettingsValue();
  const activeNote = useActiveNoteInsight();

  const royalAddress = useMemo(
    () =>
      resolveRoyalAddress({
        userPreferredName: settings.userPreferredName,
        userRoyalTitle: settings.userRoyalTitle,
      }),
    [settings.userPreferredName, settings.userRoyalTitle]
  );

  const presenceLine = useMemo(
    () =>
      resolvePresenceLine({
        activeNote,
        hasMessages,
        isGenerating,
        royalAddress,
        lastUserMessage: latestUserMessage,
      }),
    [activeNote, hasMessages, isGenerating, royalAddress, latestUserMessage]
  );

  return (
    <div className="hendrik-archivist-presence" data-status={isGenerating ? "thinking" : "ready"}>
      <div className="hendrik-archivist-presence__identity">
        <div className="hendrik-archivist-presence__avatar" aria-hidden="true" />
        <span className="hendrik-archivist-presence__name">Hendrik</span>
        <span className="hendrik-archivist-presence__separator" aria-hidden="true" />
        <span className="hendrik-archivist-presence__line">{presenceLine}</span>
      </div>
    </div>
  );
}
