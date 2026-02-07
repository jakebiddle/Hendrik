import ChatModelManager from "@/LLMProviders/chatModelManager";
import { CustomModel, ProjectConfig, getCurrentProject } from "@/aiParams";
import { ContextManageModal } from "@/components/modals/project/context-manage-modal";
import { TruncatedText } from "@/components/TruncatedText";
import {
  PROJECT_COLOR_OPTIONS,
  PROJECT_ICON_OPTIONS,
  resolveProjectAppearance,
} from "@/components/project/projectAppearance";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { ModelDisplay } from "@/components/ui/model-display";
import { SettingSlider } from "@/components/ui/setting-slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_MODEL_SETTING } from "@/constants";
import { logError } from "@/logger";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { getDecodedPatterns } from "@/search/searchUtils";
import { isProjectModelEnabled } from "@/utils/modelUtils";
import {
  checkModelApiKey,
  err2String,
  findCustomModel,
  randomUUID,
  removeErrorTags,
  removeThinkTags,
  withSuppressedTokenWarnings,
} from "@/utils";
import { Loader2, Sparkles } from "lucide-react";
import { Notice } from "obsidian";
import React, { useMemo, useState } from "react";

interface ProjectFormProps {
  initialProject?: ProjectConfig;
  onSave: (project: ProjectConfig) => Promise<void>;
  onCancel: () => void;
}

/**
 * Build a prompt for generating a concise project landing summary.
 */
function buildProjectSummaryDraftPrompt(project: ProjectConfig): string {
  const context = project.contextSource ?? {};
  const inclusionText = (context.inclusions ?? "").trim() || "Not specified";
  const exclusionText = (context.exclusions ?? "").trim() || "Not specified";
  const webUrls = (context.webUrls ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  const youtubeUrls = (context.youtubeUrls ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);

  return `Generate a concise project summary for a project landing page.

Rules:
- 2 to 4 short sentences.
- Keep it practical and specific.
- Mention project purpose, likely workflow focus, and key context sources.
- Do not use bullet points, markdown, or quotes.
- Use the same language as the project text.

Project data:
- Name: ${project.name || "Untitled Project"}
- Description: ${project.description?.trim() || "Not provided"}
- System prompt: ${project.systemPrompt?.trim() || "Not provided"}
- Context inclusions: ${inclusionText}
- Context exclusions: ${exclusionText}
- Web URLs (${webUrls.length}): ${webUrls.join(", ") || "None"}
- YouTube URLs (${youtubeUrls.length}): ${youtubeUrls.join(", ") || "None"}`;
}

/**
 * Normalizes raw model output into clean plain text for summary display.
 */
function normalizeDraftSummaryText(rawOutput: unknown): string {
  return removeErrorTags(removeThinkTags(rawOutput))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * Project create/edit form rendered in chat-native UI surfaces.
 */
export function ProjectForm({ initialProject, onSave, onCancel }: ProjectFormProps) {
  const settings = useSettingsValue();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDraftingSummary, setIsDraftingSummary] = useState(false);
  const [touched, setTouched] = useState({
    name: false,
    systemPrompt: false,
    projectModelKey: false,
    inclusions: false,
  });

  const [formData, setFormData] = useState<ProjectConfig>(() => {
    const appearance = resolveProjectAppearance(initialProject);

    return {
      id: initialProject?.id ?? randomUUID(),
      name: initialProject?.name ?? "",
      description: initialProject?.description ?? "",
      projectSummary: initialProject?.projectSummary ?? "",
      appearance: {
        icon: appearance.icon,
        color: appearance.color,
      },
      systemPrompt: initialProject?.systemPrompt ?? "",
      projectModelKey: initialProject?.projectModelKey ?? "",
      modelConfigs: {
        temperature: initialProject?.modelConfigs?.temperature ?? DEFAULT_MODEL_SETTING.TEMPERATURE,
        maxTokens: initialProject?.modelConfigs?.maxTokens ?? DEFAULT_MODEL_SETTING.MAX_TOKENS,
      },
      contextSource: {
        inclusions: initialProject?.contextSource?.inclusions ?? "",
        exclusions: initialProject?.contextSource?.exclusions ?? "",
        webUrls: initialProject?.contextSource?.webUrls ?? "",
        youtubeUrls: initialProject?.contextSource?.youtubeUrls ?? "",
      },
      created: initialProject?.created ?? Date.now(),
      UsageTimestamps: initialProject?.UsageTimestamps ?? Date.now(),
    };
  });

  const availableProjectModels = useMemo(
    () =>
      settings.activeModels.filter(
        (model) => model.enabled && !model.isEmbeddingModel && isProjectModelEnabled(model)
      ),
    [settings.activeModels]
  );

  const currentConfiguredModel = useMemo(
    () =>
      settings.activeModels.find(
        (model) => getModelKeyFromModel(model) === formData.projectModelKey
      ),
    [settings.activeModels, formData.projectModelKey]
  );

  const isCurrentModelMissingFromAvailable = Boolean(
    formData.projectModelKey &&
      !availableProjectModels.some(
        (model) => getModelKeyFromModel(model) === formData.projectModelKey
      )
  );

  const showContext = getDecodedPatterns(
    formData.contextSource.inclusions || formData.contextSource.exclusions || "nothing"
  )
    .reverse()
    .join(",");
  const resolvedAppearance = resolveProjectAppearance(formData);

  /**
   * Open the context manager for the currently edited project and keep local form state in sync.
   */
  const handleEditProjectContext = (originProject: ProjectConfig) => {
    let projectToEdit = originProject;

    if (initialProject?.id) {
      const currentProject = getCurrentProject();
      if (currentProject?.id === originProject.id) {
        projectToEdit = currentProject;
      }
    }

    const modal = new ContextManageModal(
      app,
      async (updatedProject: ProjectConfig) => {
        setFormData(updatedProject);
      },
      projectToEdit
    );
    modal.open();
  };

  /**
   * Validate required fields needed for persistence.
   */
  const isFormValid = () => {
    return Boolean(formData.name.trim()) && Boolean(formData.projectModelKey);
  };

  /**
   * Update form state for both top-level and nested project fields.
   */
  const handleInputChange = (
    field: string,
    value: string | number | string[] | Record<string, unknown>
  ) => {
    setFormData((prev) => {
      if (typeof value === "string" && field === "projectModelKey") {
        value = value.trim();
      }

      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        value = value.map((item) => item.trim()).filter(Boolean);
      }

      if (field.includes(".")) {
        const [parent, child] = field.split(".");
        const parentKey = parent as keyof typeof prev;
        const parentValue = prev[parentKey];
        const parentObject =
          typeof parentValue === "object" && parentValue !== null
            ? (parentValue as Record<string, unknown>)
            : {};

        return {
          ...prev,
          [parent]: {
            ...parentObject,
            [child]: value,
          },
        };
      }

      return {
        ...prev,
        [field]: value,
      };
    });
  };

  /**
   * Persist project after validating required fields and normalizing user input.
   */
  const handleSave = async () => {
    const normalizedName = formData.name.trim();
    const normalizedProject: ProjectConfig = {
      ...formData,
      name: normalizedName,
      projectModelKey: formData.projectModelKey.trim(),
    };

    const requiredFields: Array<keyof ProjectConfig> = ["name", "projectModelKey"];
    const missingFields = requiredFields.filter((field) => !normalizedProject[field]);

    if (missingFields.length > 0) {
      setTouched((prev) => ({
        ...prev,
        ...Object.fromEntries(missingFields.map((field) => [field, true])),
      }));
      new Notice("Please fill in all required fields");
      return;
    }

    try {
      setIsSubmitting(true);
      await onSave(normalizedProject);
    } catch (error) {
      new Notice(err2String(error));
      setTouched((prev) => ({
        ...prev,
        name: true,
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Draft an AI-generated project summary using the currently selected project model.
   */
  const handleDraftSummary = async () => {
    if (isDraftingSummary) {
      return;
    }

    if (!formData.projectModelKey.trim()) {
      new Notice("Select a default model before drafting a summary.");
      return;
    }

    let selectedModel: CustomModel;
    try {
      selectedModel = findCustomModel(formData.projectModelKey, settings.activeModels);
    } catch {
      new Notice("Selected project model is no longer available.");
      return;
    }

    if (!selectedModel.enabled) {
      new Notice("Selected project model is disabled. Enable it before drafting a summary.");
      return;
    }

    const { hasApiKey, errorNotice } = checkModelApiKey(selectedModel, settings);
    if (!hasApiKey) {
      new Notice(errorNotice ?? "API credentials are missing for the selected model.");
      return;
    }

    const summaryPrompt = buildProjectSummaryDraftPrompt(formData);
    const mergedModelConfig: CustomModel = {
      ...selectedModel,
      ...formData.modelConfigs,
      stream: false,
    };

    try {
      setIsDraftingSummary(true);
      const chatModel = await ChatModelManager.getInstance().createModelInstance(mergedModelConfig);
      const response = await withSuppressedTokenWarnings(async () =>
        chatModel.invoke([{ role: "user", content: summaryPrompt }])
      );

      const responseContent =
        typeof response === "string"
          ? response
          : ((response as { content?: unknown; text?: unknown }).content ??
            (response as { text?: unknown }).text ??
            "");

      const summaryDraft = normalizeDraftSummaryText(responseContent);
      if (!summaryDraft) {
        new Notice("Summary draft returned empty content. Try again with a different model.");
        return;
      }

      handleInputChange("projectSummary", summaryDraft);
    } catch (error) {
      logError("[ProjectForm] Failed to draft project summary:", error);
      new Notice("Failed to draft project summary. Check model access and try again.");
    } finally {
      setIsDraftingSummary(false);
    }
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-2 tw-p-4">
      <div className="tw-mb-2 tw-text-xl tw-font-bold tw-text-normal">
        {initialProject ? "Edit Project" : "New Project"}
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <FormField
          label="Project Name"
          required
          error={touched.name && !formData.name.trim()}
          errorMessage="Project name is required"
        >
          <Input
            type="text"
            value={formData.name}
            onChange={(e) => handleInputChange("name", e.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
            className="tw-w-full"
          />
        </FormField>

        <FormField
          label="Description"
          description="Briefly describe the purpose and goals of the project"
        >
          <Input
            type="text"
            value={formData.description}
            onChange={(e) => handleInputChange("description", e.target.value)}
            className="tw-w-full"
          />
        </FormField>

        <FormField
          label="Project System Prompt"
          description="Custom instructions for how the AI should behave in this project context"
        >
          <Textarea
            value={formData.systemPrompt}
            onChange={(e) => handleInputChange("systemPrompt", e.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, systemPrompt: true }))}
            className="tw-min-h-32"
          />
        </FormField>

        <div className="tw-space-y-4">
          <div className="tw-text-base tw-font-medium">Appearance</div>
          <div className="tw-grid tw-grid-cols-1 tw-gap-4 md:tw-grid-cols-2">
            <FormField label="Icon">
              <div className="tw-grid tw-grid-cols-4 tw-gap-2">
                {PROJECT_ICON_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const isSelected = resolvedAppearance.icon === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleInputChange("appearance.icon", option.id)}
                      className={`tw-flex tw-h-10 tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-solid tw-transition-colors ${
                        isSelected
                          ? "tw-border-accent tw-text-accent tw-bg-interactive-accent/20"
                          : "tw-border-border tw-text-muted hover:tw-bg-primary-alt"
                      }`}
                      title={option.label}
                    >
                      <Icon className="tw-size-4" />
                    </button>
                  );
                })}
              </div>
            </FormField>

            <FormField label="Color">
              <div className="tw-grid tw-grid-cols-3 tw-gap-2">
                {PROJECT_COLOR_OPTIONS.map((option) => {
                  const isSelected = resolvedAppearance.color === option.value;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleInputChange("appearance.color", option.value)}
                      className={`tw-flex tw-h-10 tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-solid tw-transition-transform hover:tw-scale-[1.02] ${
                        isSelected ? "tw-border-accent" : "tw-border-border"
                      }`}
                      title={option.label}
                      style={{ backgroundColor: option.value }}
                    >
                      <span className="tw-text-xs tw-font-semibold tw-text-on-accent">
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </FormField>
          </div>
        </div>

        <FormField
          label="Default Model"
          required
          error={touched.projectModelKey && !formData.projectModelKey}
          errorMessage="Default model is required"
        >
          <div className="tw-flex tw-flex-col tw-gap-2">
            <Select
              value={formData.projectModelKey || undefined}
              onOpenChange={(open) => {
                if (!open) {
                  setTouched((prev) => ({ ...prev, projectModelKey: true }));
                }
              }}
              onValueChange={(value) => {
                const selectedModel = settings.activeModels.find(
                  (model) => getModelKeyFromModel(model) === value
                );
                if (!selectedModel) {
                  return;
                }

                const { hasApiKey, errorNotice } = checkModelApiKey(selectedModel, settings);
                if (!hasApiKey && errorNotice) {
                  // Keep selection allowed; error will surface in chat on send.
                }

                handleInputChange("projectModelKey", value);
                setTouched((prev) => ({ ...prev, projectModelKey: true }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a model">
                  {currentConfiguredModel ? (
                    <ModelDisplay model={currentConfiguredModel} iconSize={12} />
                  ) : (
                    <span>Select a model</span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="tw-max-h-64">
                {availableProjectModels.map((model) => (
                  <SelectItem key={getModelKeyFromModel(model)} value={getModelKeyFromModel(model)}>
                    <ModelDisplay model={model} iconSize={12} />
                  </SelectItem>
                ))}
                {isCurrentModelMissingFromAvailable && currentConfiguredModel && (
                  <SelectItem value={getModelKeyFromModel(currentConfiguredModel)}>
                    <span className="tw-opacity-80">
                      <ModelDisplay model={currentConfiguredModel} iconSize={12} /> (Unavailable)
                    </span>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>

            {availableProjectModels.length === 0 && (
              <div className="tw-text-xs tw-text-faint">
                No enabled chat models are available for projects. Enable at least one model in
                settings.
              </div>
            )}
          </div>
        </FormField>

        <div className="tw-space-y-4">
          <div className="tw-text-base tw-font-medium">Model Configuration</div>
          <div className="tw-grid tw-grid-cols-1 tw-gap-4">
            <FormField label="Temperature">
              <SettingSlider
                value={formData.modelConfigs?.temperature ?? DEFAULT_MODEL_SETTING.TEMPERATURE}
                onChange={(value) => handleInputChange("modelConfigs.temperature", value)}
                min={0}
                max={2}
                step={0.01}
                className="tw-w-full"
              />
            </FormField>
            <FormField label="Token Limit">
              <SettingSlider
                value={formData.modelConfigs?.maxTokens ?? DEFAULT_MODEL_SETTING.MAX_TOKENS}
                onChange={(value) => handleInputChange("modelConfigs.maxTokens", value)}
                min={1}
                max={65000}
                step={1}
                className="tw-w-full"
              />
            </FormField>
          </div>
        </div>

        <div className="tw-space-y-4">
          <div className="tw-text-base tw-font-medium">Context Sources</div>
          <FormField
            label={
              <div className="tw-flex tw-items-center tw-gap-2">
                <span>File Context</span>
                <HelpTooltip
                  buttonClassName="tw-size-4 tw-text-muted"
                  content={
                    <div className="tw-max-w-80">
                      <strong>Supported File Types:</strong>
                      <br />
                      <strong>- Documents:</strong> pdf, doc, docx, ppt, pptx, epub, txt, rtf and
                      many more
                      <br />
                      <strong>- Images:</strong> jpg, png, svg, gif, bmp, webp, tiff
                      <br />
                      <strong>- Spreadsheets:</strong> xlsx, xls, csv, numbers
                      <br />
                      <br />
                      Non-markdown files are converted to markdown in the background.
                      <br />
                      <strong>Rate limit:</strong> 50 files or 100MB per 3 hours, whichever is
                      reached first.
                    </div>
                  }
                />
              </div>
            }
            description="Define patterns to include specific files, folders or tags (specified in the note property) in the project context."
          >
            <div className="tw-flex tw-items-center tw-gap-2">
              <div className="tw-flex tw-flex-1 tw-flex-row">
                <TruncatedText className="tw-max-w-[100px] tw-text-sm tw-text-accent">
                  {showContext}
                </TruncatedText>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  handleEditProjectContext(formData);
                }}
              >
                Manage Context
              </Button>
            </div>
          </FormField>

          <FormField label="Web URLs">
            <Textarea
              value={formData.contextSource?.webUrls}
              onChange={(e) => {
                const urls = e.target.value.split("\n");
                const processedUrls = urls.map((url) => {
                  if (!url.trim()) return url;
                  try {
                    new URL(url.trim());
                    return url;
                  } catch {
                    return url;
                  }
                });

                handleInputChange("contextSource.webUrls", processedUrls.join("\n"));
              }}
              placeholder="Enter web URLs, one per line"
              className="tw-min-h-20 tw-w-full"
            />
          </FormField>

          <FormField label="YouTube URLs">
            <Textarea
              value={formData.contextSource?.youtubeUrls}
              onChange={(e) => {
                const urls = e.target.value.split("\n");
                const processedUrls = urls.map((url) => {
                  if (!url.trim()) return url;
                  try {
                    const urlObj = new URL(url.trim());
                    if (
                      urlObj.hostname.includes("youtube.com") ||
                      urlObj.hostname.includes("youtu.be")
                    ) {
                      return url;
                    }
                    return url;
                  } catch {
                    return url;
                  }
                });

                handleInputChange("contextSource.youtubeUrls", processedUrls.join("\n"));
              }}
              placeholder="Enter YouTube URLs, one per line"
              className="tw-min-h-20 tw-w-full"
            />
          </FormField>
        </div>

        <FormField
          label="Project Summary"
          description="Optional summary shown on the project landing page. Use Draft Summary to generate with the selected project model."
        >
          <Textarea
            value={formData.projectSummary ?? ""}
            onChange={(e) => handleInputChange("projectSummary", e.target.value)}
            className="tw-min-h-24 tw-w-full"
            placeholder="Describe this project in a few concise sentences..."
          />
          <div className="tw-mt-2 tw-flex tw-items-center tw-justify-between tw-gap-2">
            <span className="tw-text-xs tw-text-faint">Tip: keep this to 2-4 short sentences.</span>
            <Button
              variant="ghost2"
              size="sm"
              onClick={handleDraftSummary}
              disabled={isDraftingSummary || !formData.projectModelKey}
            >
              {isDraftingSummary ? (
                <Loader2 className="tw-size-3.5 tw-animate-spin" />
              ) : (
                <Sparkles className="tw-size-3.5" />
              )}
              {isDraftingSummary ? "Drafting..." : "Draft Summary"}
            </Button>
          </div>
        </FormField>
      </div>

      <div className="tw-mt-4 tw-flex tw-items-center tw-justify-end tw-gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSubmitting || !isFormValid()}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
