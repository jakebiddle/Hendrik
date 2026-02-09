import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { logFileManager } from "@/logFileManager";
import { flushRecordedPromptPayloadToLog } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { SettingsSection } from "@/settings/v2/components/SettingsSection";
import { Brain, Bug, Globe, Shield } from "lucide-react";
import React from "react";

export const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <div className="tw-space-y-6">
      {/* Memory */}
      <SettingsSection
        icon={<Brain className="tw-size-4" />}
        title="Memory"
        description="Configure conversation memory retention."
        accentColor="var(--color-purple)"
        searchTerms={[
          "Memory Folder Name",
          "Enable Recent Conversations",
          "Max Recent Conversations",
          "Enable Saved Memory",
        ]}
      >
        <SettingItem
          type="text"
          title="Memory Folder Name"
          description="Folder where Hendrik stores memory files."
          value={settings.memoryFolderName}
          onChange={(value) => updateSetting("memoryFolderName", value)}
          placeholder="hendrik/hendrik-memory"
        />

        <SettingItem
          type="switch"
          title="Enable Recent Conversations"
          description="Allow Hendrik to remember and reference recent conversation context across chats."
          checked={settings.enableRecentConversations}
          onCheckedChange={(checked) => updateSetting("enableRecentConversations", checked)}
        />

        <SettingItem
          type="slider"
          title="Max Recent Conversations"
          description="Maximum number of recent conversations Hendrik will remember."
          value={settings.maxRecentConversations}
          onChange={(value) => updateSetting("maxRecentConversations", value)}
          min={10}
          max={50}
          step={5}
        />

        <SettingItem
          type="switch"
          title="Enable Saved Memory"
          description="Allow Hendrik to save and recall important information from your conversations."
          checked={settings.enableSavedMemory}
          onCheckedChange={(checked) => updateSetting("enableSavedMemory", checked)}
        />
      </SettingsSection>

      {/* Proxy & Network */}
      <SettingsSection
        icon={<Globe className="tw-size-4" />}
        title="Proxy & Network"
        description="Configure optional proxy endpoints."
        accentColor="var(--color-blue)"
        collapsible
        defaultOpen={false}
        searchTerms={["OpenAI Proxy Base URL", "OpenAI Embedding Proxy Base URL"]}
      >
        <SettingItem
          type="text"
          title="OpenAI Proxy Base URL"
          description="Custom proxy URL for OpenAI API requests. Leave empty to use the default endpoint."
          value={settings.openAIProxyBaseUrl}
          onChange={(value) => updateSetting("openAIProxyBaseUrl", value)}
          placeholder="https://api.openai.com"
        />

        <SettingItem
          type="text"
          title="OpenAI Embedding Proxy Base URL"
          description="Custom proxy URL for OpenAI embedding API requests. Leave empty to use the default endpoint."
          value={settings.openAIEmbeddingProxyBaseUrl}
          onChange={(value) => updateSetting("openAIEmbeddingProxyBaseUrl", value)}
          placeholder="https://api.openai.com"
        />
      </SettingsSection>

      {/* Security */}
      <SettingsSection
        icon={<Shield className="tw-size-4" />}
        title="Security"
        description="Configure encryption for stored credentials."
        accentColor="var(--color-orange)"
        searchTerms={["Enable Encryption", "encryption"]}
      >
        <SettingItem
          type="switch"
          title="Enable Encryption"
          description="Enable encryption for the API keys stored in your vault settings."
          checked={settings.enableEncryption}
          onCheckedChange={(checked) => {
            updateSetting("enableEncryption", checked);
          }}
        />
      </SettingsSection>

      {/* Debugging */}
      <SettingsSection
        icon={<Bug className="tw-size-4" />}
        title="Debugging"
        description="Configure logging and diagnostic output."
        accentColor="var(--color-red)"
        searchTerms={["Debug Mode", "Create Log File", "log"]}
      >
        <SettingItem
          type="switch"
          title="Debug Mode"
          description="Log debug messages to the developer console."
          checked={settings.debug}
          onCheckedChange={(checked) => {
            updateSetting("debug", checked);
          }}
        />

        <SettingItem
          type="custom"
          title="Create Log File"
          description={`Open the Hendrik log file (${logFileManager.getLogPath()}) for easy sharing when reporting issues.`}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await flushRecordedPromptPayloadToLog();
              await logFileManager.flush();
              await logFileManager.openLogFile();
            }}
          >
            Create Log File
          </Button>
        </SettingItem>
      </SettingsSection>
    </div>
  );
};
