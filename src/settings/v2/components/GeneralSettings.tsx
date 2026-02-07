import { ROYAL_TITLE_OPTIONS } from "@/components/chat-components/companionTone";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { SEND_SHORTCUT } from "@/constants";
import { cn } from "@/lib/utils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { SettingsSection } from "@/settings/v2/components/SettingsSection";
import { formatDateTime } from "@/utils";
import { isSortStrategy } from "@/utils/recentUsageManager";
import { Loader2, MessageSquare, Monitor, User } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";

export const GeneralSettings: React.FC = () => {
  const settings = useSettingsValue();
  const [isChecking, setIsChecking] = useState(false);
  const [conversationNoteName, setConversationNoteName] = useState(
    settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}"
  );

  const applyCustomNoteFormat = () => {
    setIsChecking(true);

    try {
      const format = conversationNoteName || "{$date}_{$time}__{$topic}";
      const requiredVars = ["{$date}", "{$time}", "{$topic}"];
      const missingVars = requiredVars.filter((v) => !format.includes(v));

      if (missingVars.length > 0) {
        new Notice(`Error: Missing required variables: ${missingVars.join(", ")}`, 4000);
        return;
      }

      const illegalChars = /[\\/:*?"<>|]/;
      const formatWithoutVars = format
        .replace(/\{\$date}/g, "")
        .replace(/\{\$time}/g, "")
        .replace(/\{\$topic}/g, "");

      if (illegalChars.test(formatWithoutVars)) {
        new Notice(`Error: Format contains illegal characters (\\/:*?"<>|)`, 4000);
        return;
      }

      const { fileName: timestampFileName } = formatDateTime(new Date());
      const firstTenWords = "test topic name";

      const customFileName = format
        .replace("{$topic}", firstTenWords.slice(0, 100).replace(/\s+/g, "_"))
        .replace("{$date}", timestampFileName.split("_")[0])
        .replace("{$time}", timestampFileName.split("_")[1]);

      updateSetting("defaultConversationNoteName", format);
      setConversationNoteName(format);
      new Notice(`Format applied successfully! Example: ${customFileName}`, 4000);
    } catch (error) {
      new Notice(`Error applying format: ${error.message}`, 4000);
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="tw-space-y-6">
      {/* Interface Section */}
      <SettingsSection
        icon={<Monitor className="tw-size-4" />}
        title="Interface"
        description="Controls how Hendrik appears and behaves in your workspace"
        accentColor="var(--color-blue)"
      >
        <SettingItem
          type="select"
          title="Send Shortcut"
          description={
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-leading-none">Choose keyboard shortcut to send messages</span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                    <div className="tw-text-sm tw-font-medium tw-text-accent">
                      Shortcut not working?
                    </div>
                    <div className="tw-text-xs tw-text-muted">
                      If your selected shortcut doesn&#39;t work, check
                      <strong> Obsidian&#39;s Settings &rarr; Hotkeys</strong> to see if another
                      command is using the same key combination.
                    </div>
                  </div>
                }
              />
            </div>
          }
          value={settings.defaultSendShortcut}
          onChange={(value) => updateSetting("defaultSendShortcut", value as SEND_SHORTCUT)}
          options={[
            { label: "Enter", value: SEND_SHORTCUT.ENTER },
            { label: "Shift + Enter", value: SEND_SHORTCUT.SHIFT_ENTER },
          ]}
        />

        <SettingItem
          type="switch"
          title="Auto-Add Active Content to Context"
          description="Automatically add the active note or Web Viewer tab (Desktop only) to chat context when sending messages."
          checked={settings.autoAddActiveContentToContext}
          onCheckedChange={(checked) => {
            updateSetting("autoAddActiveContentToContext", checked);
          }}
        />

        <SettingItem
          type="switch"
          title="Auto-Add Selection to Context"
          description="Automatically add selected text from notes or Web Viewer (Desktop only) to chat context."
          checked={settings.autoAddSelectionToContext}
          onCheckedChange={(checked) => {
            updateSetting("autoAddSelectionToContext", checked);
          }}
        />

        <SettingItem
          type="switch"
          title="Images in Markdown"
          description="Pass embedded images in markdown to the AI along with the text. Only works with multimodal models."
          checked={settings.passMarkdownImages}
          onCheckedChange={(checked) => {
            updateSetting("passMarkdownImages", checked);
          }}
        />

        <SettingItem
          type="switch"
          title="Relevant Notes"
          description="Show relevant notes in the chat view"
          checked={settings.showRelevantNotes}
          onCheckedChange={(checked) => updateSetting("showRelevantNotes", checked)}
        />
      </SettingsSection>

      {/* Personalization Section */}
      <SettingsSection
        icon={<User className="tw-size-4" />}
        title="Personalization"
        description="How Hendrik addresses and interacts with you"
        accentColor="var(--color-purple)"
      >
        <SettingItem
          type="text"
          title="Preferred Name"
          description="Optional name Hendrik uses when addressing you."
          value={settings.userPreferredName}
          onChange={(value) => updateSetting("userPreferredName", value)}
          placeholder="Optional"
        />

        <SettingItem
          type="select"
          title="Royal Title"
          description="How Hendrik addresses you in companion commentary."
          value={settings.userRoyalTitle}
          onChange={(value) => updateSetting("userRoyalTitle", value)}
          options={ROYAL_TITLE_OPTIONS.map((title) => ({ label: title, value: title }))}
        />

        <SettingItem
          type="select"
          title="Tone"
          description="The conversational style Hendrik uses in responses."
          value={settings.responseTone}
          onChange={(value) => updateSetting("responseTone", value)}
          options={[
            { label: "Conversational", value: "conversational" },
            { label: "Formal", value: "formal" },
            { label: "Concise", value: "concise" },
            { label: "Detailed", value: "detailed" },
          ]}
        />

        <SettingItem
          type="select"
          title="Response Length"
          description="How much detail Hendrik includes by default."
          value={settings.responseLength}
          onChange={(value) => updateSetting("responseLength", value)}
          options={[
            { label: "Brief", value: "brief" },
            { label: "Standard", value: "standard" },
            { label: "Thorough", value: "thorough" },
          ]}
        />

        <SettingItem
          type="select"
          title="Expertise Level"
          description="Adjusts explanations to match your knowledge level."
          value={settings.expertiseLevel}
          onChange={(value) => updateSetting("expertiseLevel", value)}
          options={[
            { label: "Beginner", value: "beginner" },
            { label: "Intermediate", value: "intermediate" },
            { label: "Expert", value: "expert" },
          ]}
        />

        <SettingItem
          type="text"
          title="Preferred Language"
          description="Language Hendrik responds in. Leave blank to match your query language."
          value={settings.preferredLanguage}
          onChange={(value) => updateSetting("preferredLanguage", value)}
          placeholder="e.g. English, Spanish, Japanese"
        />
      </SettingsSection>

      {/* Conversations Section */}
      <SettingsSection
        icon={<MessageSquare className="tw-size-4" />}
        title="Conversations"
        description="Saving, naming, and sorting your chat conversations"
        accentColor="var(--color-green)"
      >
        <SettingItem
          type="switch"
          title="Autosave Chat"
          description="Automatically saves the chat after every user message and AI response."
          checked={settings.autosaveChat}
          onCheckedChange={(checked) => updateSetting("autosaveChat", checked)}
        />

        <SettingItem
          type="switch"
          title="Generate AI Chat Title on Save"
          description="When enabled, uses an AI model to generate a concise title for saved chat notes."
          checked={settings.generateAIChatTitleOnSave}
          onCheckedChange={(checked) => updateSetting("generateAIChatTitleOnSave", checked)}
        />

        <SettingItem
          type="text"
          title="Default Conversation Folder Name"
          description="The default folder name where chat conversations will be saved."
          value={settings.defaultSaveFolder}
          onChange={(value) => updateSetting("defaultSaveFolder", value)}
          placeholder="hendrik/hendrik-conversations"
        />

        <SettingItem
          type="text"
          title="Default Conversation Tag"
          description="The default tag to be used when saving a conversation."
          value={settings.defaultConversationTag}
          onChange={(value) => updateSetting("defaultConversationTag", value)}
          placeholder="ai-conversations"
        />

        <SettingItem
          type="custom"
          title="Conversation Filename Template"
          description={
            <div className="tw-flex tw-items-start tw-gap-1.5">
              <span className="tw-leading-none">
                Customize the format of saved conversation note names.
              </span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                    <div className="tw-text-sm tw-font-medium tw-text-accent">
                      Note: All the following variables must be included in the template.
                    </div>
                    <div>
                      <div className="tw-text-sm tw-font-medium tw-text-muted">
                        Available variables:
                      </div>
                      <ul className="tw-pl-4 tw-text-sm tw-text-muted">
                        <li>
                          <strong>{"{$date}"}</strong>: Date in YYYYMMDD format
                        </li>
                        <li>
                          <strong>{"{$time}"}</strong>: Time in HHMMSS format
                        </li>
                        <li>
                          <strong>{"{$topic}"}</strong>: Chat conversation topic
                        </li>
                      </ul>
                    </div>
                  </div>
                }
              />
            </div>
          }
        >
          <div className="tw-flex tw-w-[320px] tw-items-center tw-gap-1.5">
            <Input
              type="text"
              className={cn(
                "tw-min-w-[80px] tw-grow tw-transition-all tw-duration-200",
                isChecking ? "tw-w-[80px]" : "tw-w-[120px]"
              )}
              placeholder="{$date}_{$time}__{$topic}"
              value={conversationNoteName}
              onChange={(e) => setConversationNoteName(e.target.value)}
              disabled={isChecking}
            />
            <Button
              onClick={() => applyCustomNoteFormat()}
              disabled={isChecking}
              variant="secondary"
            >
              {isChecking ? (
                <>
                  <Loader2 className="tw-mr-2 tw-size-4 tw-animate-spin" />
                  Apply
                </>
              ) : (
                "Apply"
              )}
            </Button>
          </div>
        </SettingItem>

        <SettingItem
          type="select"
          title="Chat History Sort Strategy"
          description="Sort order for the chat history list"
          value={settings.chatHistorySortStrategy}
          onChange={(value) => {
            if (isSortStrategy(value)) {
              updateSetting("chatHistorySortStrategy", value);
            }
          }}
          options={[
            { label: "Recency", value: "recent" },
            { label: "Created", value: "created" },
            { label: "Alphabetical", value: "name" },
          ]}
        />

        <SettingItem
          type="select"
          title="Project List Sort Strategy"
          description="Sort order for the project list"
          value={settings.projectListSortStrategy}
          onChange={(value) => {
            if (isSortStrategy(value)) {
              updateSetting("projectListSortStrategy", value);
            }
          }}
          options={[
            { label: "Recency", value: "recent" },
            { label: "Created", value: "created" },
            { label: "Alphabetical", value: "name" },
          ]}
        />
      </SettingsSection>
    </div>
  );
};
