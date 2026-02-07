import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { PasswordInput } from "@/components/ui/password-input";
import { ProviderSettingsKeyMap, SettingKeyProviders } from "@/constants";
import { cn } from "@/lib/utils";
import { updateSetting } from "@/settings/model";
import { GitHubCopilotAuth } from "@/settings/v2/components/GitHubCopilotAuth";
import { LocalServicesSection } from "@/settings/v2/components/LocalServicesSection";
import { ModelImporter } from "@/settings/v2/components/ModelImporter";
import { getNeedSetKeyProvider, getProviderInfo, getProviderLabel } from "@/utils";
import { ChevronDown, ChevronRight, ChevronUp, Info, Key, Monitor, Users } from "lucide-react";
import { getApiKeyForProvider } from "@/utils/modelUtils";
import { App, Modal } from "obsidian";
import React, { useEffect, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface ApiKeyModalContentProps {
  onClose: () => void;
  onGoToModelTab?: () => void;
}

interface ProviderKeyItem {
  provider: SettingKeyProviders;
  apiKey: string;
}

/** Status dot showing if a provider has an API key configured */
const ProviderStatusDot: React.FC<{ hasKey: boolean }> = ({ hasKey }) => (
  <span
    className={cn(
      "tw-size-2 tw-shrink-0 tw-rounded-full",
      hasKey ? "tw-bg-[var(--color-green)]" : "tw-bg-[var(--color-base-50)]"
    )}
  />
);

/** Section wrapper for the modal with icon, title, and colored left border */
const ModalSection: React.FC<{
  icon: React.ReactNode;
  title: string;
  accentColor: string;
  children: React.ReactNode;
}> = ({ icon, title, accentColor, children }) => (
  <div
    className="tw-rounded-lg tw-border tw-border-l-[3px] tw-border-border tw-bg-primary"
    style={{ borderLeftColor: accentColor }}
  >
    <div className="tw-flex tw-items-center tw-gap-2.5 tw-px-4 tw-pb-1 tw-pt-3">
      <div
        className="tw-flex tw-size-6 tw-items-center tw-justify-center tw-rounded-md"
        style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)` }}
      >
        <div className="tw-size-3.5" style={{ color: accentColor }}>
          {icon}
        </div>
      </div>
      <h3 className="tw-text-sm tw-font-semibold">{title}</h3>
    </div>
    <div className="tw-px-4 tw-pb-3 tw-pt-1">{children}</div>
  </div>
);

function ApiKeyModalContent({ onClose, onGoToModelTab }: ApiKeyModalContentProps) {
  const [expandedProvider, setExpandedProvider] = useState<SettingKeyProviders | null>(null);

  useEffect(() => {
    setExpandedProvider(null);
  }, []);

  const providers: ProviderKeyItem[] = getNeedSetKeyProvider().map((provider) => {
    const providerKey = provider as SettingKeyProviders;
    const apiKey = getApiKeyForProvider(providerKey);
    return {
      provider: providerKey,
      apiKey,
    };
  });

  const handleApiKeyChange = (provider: SettingKeyProviders, value: string) => {
    const currentKey = getApiKeyForProvider(provider);
    if (currentKey !== value) {
      updateSetting(ProviderSettingsKeyMap[provider], value);
    }
  };

  const configuredCount = providers.filter((p) => !!p.apiKey).length;

  return (
    <div className="tw-p-5 sm:tw-max-w-[540px]">
      {/* Header */}
      <div className="tw-mb-5">
        <h2 className="tw-text-lg tw-font-bold">AI Provider Settings</h2>
        <p className="tw-mt-1 tw-text-xs tw-text-muted">
          {configuredCount} of {providers.length} cloud providers configured
        </p>
      </div>

      <div className="tw-space-y-4">
        {/* Cloud Providers */}
        <ModalSection
          icon={<Key className="tw-size-3.5" />}
          title="Cloud Providers"
          accentColor="var(--color-orange)"
        >
          <div className="tw-space-y-3">
            {providers.map((item: ProviderKeyItem) => {
              const providerInfo = getProviderInfo(item.provider);
              const supportsModelImport = Boolean(providerInfo.listModelURL);
              const isExpanded = expandedProvider === item.provider;

              return (
                <React.Fragment key={item.provider}>
                  <div className="tw-flex tw-flex-col tw-gap-1.5">
                    <div className="tw-flex tw-items-center tw-gap-2">
                      <ProviderStatusDot hasKey={!!item.apiKey} />
                      <span className="tw-truncate tw-text-sm tw-font-medium">
                        {getProviderLabel(item.provider)}
                      </span>
                    </div>
                    <div className="tw-flex tw-flex-row tw-items-center tw-gap-2">
                      <div className="tw-flex-1">
                        <PasswordInput
                          className="tw-max-w-full"
                          value={item.apiKey}
                          onChange={(v) => handleApiKeyChange(item.provider, v)}
                        />
                      </div>
                      {supportsModelImport && (
                        <Button
                          onClick={() => {
                            setExpandedProvider(isExpanded ? null : item.provider);
                          }}
                          disabled={!item.apiKey}
                          variant="secondary"
                          size="sm"
                          className="tw-flex tw-items-center tw-gap-1.5 tw-whitespace-nowrap"
                        >
                          Add Model
                          {isExpanded ? (
                            <ChevronUp className="tw-size-3.5" />
                          ) : (
                            <ChevronDown className="tw-size-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                    {providerInfo.keyManagementURL && (
                      <a
                        href={providerInfo.keyManagementURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tw-text-[10px] tw-text-accent hover:tw-text-accent-hover sm:tw-text-xs"
                      >
                        Get {getProviderLabel(item.provider)} Key
                      </a>
                    )}
                  </div>
                  {supportsModelImport && (
                    <Collapsible open={isExpanded}>
                      <CollapsibleContent className="tw-rounded-md tw-border tw-border-border tw-p-3 tw-bg-secondary/20">
                        <ModelImporter
                          provider={item.provider}
                          isReady={Boolean(item.apiKey)}
                          expanded={isExpanded}
                          credentialVersion={item.apiKey}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </ModalSection>

        {/* GitHub Copilot */}
        <ModalSection
          icon={<Users className="tw-size-3.5" />}
          title="GitHub Copilot"
          accentColor="var(--color-purple)"
        >
          <GitHubCopilotAuth />
        </ModalSection>

        {/* Local Services */}
        <ModalSection
          icon={<Monitor className="tw-size-3.5" />}
          title="Local Services"
          accentColor="var(--color-green)"
        >
          <LocalServicesSection />
        </ModalSection>

        {/* Advanced configuration guide */}
        {onGoToModelTab && (
          <div className="tw-rounded-lg tw-border tw-p-4 tw-bg-secondary/20 tw-border-border/60">
            <div className="tw-flex tw-gap-3">
              <div className="tw-mt-0.5 tw-shrink-0">
                <Info className="tw-size-4 tw-text-accent" />
              </div>
              <div className="tw-flex-1">
                <h4 className="tw-mb-1 tw-text-sm tw-font-semibold">
                  Azure OpenAI or Custom Providers?
                </h4>
                <p className="tw-mb-2 tw-text-xs tw-leading-relaxed tw-text-muted">
                  Providers like Azure OpenAI, OpenAI Format, or Local LLMs require additional
                  configuration (Base URL, Deployment Name, etc.).
                </p>
                <button
                  onClick={() => {
                    onGoToModelTab();
                    onClose();
                  }}
                  className="tw-group tw-flex tw-items-center tw-gap-1 tw-text-sm tw-font-medium tw-text-accent hover:tw-text-accent-hover"
                >
                  Go to AI Settings
                  <ChevronRight className="tw-size-4 tw-transition-transform group-hover:tw-translate-x-0.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="tw-mt-5 tw-flex tw-justify-end">
        <Button onClick={onClose} size="sm">
          Close
        </Button>
      </div>
    </div>
  );
}

export class ApiKeyDialog extends Modal {
  private root: Root;
  private onGoToModelTab?: () => void;

  constructor(app: App, onGoToModelTab?: () => void) {
    super(app);
    this.onGoToModelTab = onGoToModelTab;
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    this.root.render(
      <ApiKeyModalContent onClose={() => this.close()} onGoToModelTab={this.onGoToModelTab} />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
