import { ProjectConfig } from "@/aiParams";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import {
  buildFallbackProjectSummary,
  getProjectIconComponent,
  resolveProjectAppearance,
} from "@/components/project/projectAppearance";
import { Button } from "@/components/ui/button";
import { getModelDisplayText } from "@/components/ui/model-display";
import { extractChatDate, extractChatTitle } from "@/utils/chatHistoryUtils";
import { getSettings } from "@/settings/model";
import { Edit2, FileText, Globe, MessageCirclePlus, MessageSquare, Youtube } from "lucide-react";
import { TFile, TFolder } from "obsidian";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";

interface ProjectLandingPageProps {
  project: ProjectConfig;
  onNewChat: () => void;
  onLoadChat: (id: string) => void;
  onEdit: () => void;
}

/**
 * Decode a potentially URI-encoded value while preserving original content on failure.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parses comma-separated values into a trimmed list.
 */
function parseCsvList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => safeDecode(value.trim()))
    .filter(Boolean);
}

/**
 * Parses newline-separated values into a trimmed list.
 */
function parseLineList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Format a date as a short relative or absolute label.
 */
function formatShortDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Retrieves chat history files belonging to a specific project ID.
 */
async function getChatHistoryForProject(projectId: string): Promise<ChatHistoryItem[]> {
  const saveFolder = getSettings().defaultSaveFolder;
  const folder = app.vault.getAbstractFileByPath(saveFolder);
  if (!(folder instanceof TFolder)) return [];

  const files = app.vault.getMarkdownFiles();
  const prefix = `${projectId}__`;
  const projectFiles = files
    .filter((file: TFile) => file.path.startsWith(folder.path) && file.basename.startsWith(prefix))
    .sort((a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime);

  return projectFiles.map((file: TFile) => ({
    id: file.path,
    title: extractChatTitle(file),
    createdAt: extractChatDate(file),
    lastAccessedAt: new Date(file.stat.mtime),
  }));
}

/**
 * Render a compact list preview with overflow count.
 */
function ContextPreviewList({
  title,
  values,
  emptyLabel,
}: {
  title: string;
  values: string[];
  emptyLabel: string;
}) {
  const preview = values.slice(0, 3);
  const remaining = values.length - preview.length;

  return (
    <div className="tw-space-y-1">
      <div className="tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-[0.08em] tw-text-faint">
        {title}
      </div>
      {values.length === 0 ? (
        <div className="tw-text-xs tw-text-faint">{emptyLabel}</div>
      ) : (
        <div className="tw-flex tw-flex-col tw-gap-1">
          {preview.map((value) => (
            <div
              key={value}
              className="tw-truncate tw-rounded-md tw-border tw-border-solid tw-border-border tw-px-2 tw-py-1 tw-text-xs tw-text-muted tw-bg-primary-alt/50"
              title={value}
            >
              {value}
            </div>
          ))}
          {remaining > 0 && <div className="tw-text-xs tw-text-faint">+{remaining} more</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Project landing page shown after selecting a project, before entering chat.
 * Displays project metadata, context sources, summary, and past conversations.
 */
const ProjectLandingPage = memo(
  ({ project, onNewChat, onLoadChat, onEdit }: ProjectLandingPageProps) => {
    const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);

    useEffect(() => {
      getChatHistoryForProject(project.id).then(setChatHistory);
    }, [project.id]);

    const modelLabel = useMemo(() => {
      const model = getSettings().activeModels.find(
        (activeModel) => `${activeModel.name}|${activeModel.provider}` === project.projectModelKey
      );
      return model ? getModelDisplayText(model) : project.projectModelKey;
    }, [project.projectModelKey]);

    const inclusions = useMemo(
      () => parseCsvList(project.contextSource?.inclusions),
      [project.contextSource?.inclusions]
    );
    const webUrls = useMemo(
      () => parseLineList(project.contextSource?.webUrls),
      [project.contextSource?.webUrls]
    );
    const youtubeUrls = useMemo(
      () => parseLineList(project.contextSource?.youtubeUrls),
      [project.contextSource?.youtubeUrls]
    );

    const totalSources = inclusions.length + webUrls.length + youtubeUrls.length;
    const appearance = resolveProjectAppearance(project);
    const ProjectIcon = getProjectIconComponent(appearance.icon);
    const summaryText =
      (project.projectSummary ?? "").trim() || buildFallbackProjectSummary(project);

    const handleStartChat = useCallback(() => {
      onNewChat();
    }, [onNewChat]);

    return (
      <div className="tw-flex tw-flex-1 tw-flex-col tw-overflow-y-auto tw-p-3">
        <div
          className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-4"
          style={{
            background: `linear-gradient(155deg, color-mix(in srgb, ${appearance.color} 18%, transparent), transparent 55%)`,
          }}
        >
          <div className="tw-flex tw-items-start tw-gap-3">
            <div
              className="tw-flex tw-size-11 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-xl"
              style={{
                backgroundColor: `color-mix(in srgb, ${appearance.color} 22%, transparent)`,
                color: appearance.color,
              }}
            >
              <ProjectIcon className="tw-size-5" />
            </div>
            <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-1">
              <div className="tw-flex tw-items-center tw-gap-2">
                <h2 className="tw-m-0 tw-truncate tw-text-lg tw-font-semibold tw-text-normal">
                  {project.name}
                </h2>
                <button
                  type="button"
                  className="tw-flex tw-size-8 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-border-none tw-bg-primary-alt tw-text-muted tw-transition-colors hover:tw-bg-interactive-accent hover:tw-text-on-accent"
                  onClick={onEdit}
                  title="Edit project"
                >
                  <Edit2 className="tw-size-4" />
                </button>
              </div>
              {project.description && (
                <p className="tw-m-0 tw-line-clamp-2 tw-text-sm tw-text-muted">
                  {project.description}
                </p>
              )}
              <div className="tw-flex tw-flex-wrap tw-gap-1.5 tw-pt-1">
                <span className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-md tw-px-2 tw-py-1 tw-text-[11px] tw-text-muted tw-bg-primary-alt/70">
                  Model: {modelLabel}
                </span>
                <span className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-md tw-px-2 tw-py-1 tw-text-[11px] tw-text-muted tw-bg-primary-alt/70">
                  Sources: {totalSources}
                </span>
              </div>
            </div>
          </div>

          <div className="tw-mt-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3 tw-bg-primary-alt/40">
            <div className="tw-mb-1 tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-[0.08em] tw-text-faint">
              Summary
            </div>
            <p className="tw-m-0 tw-text-sm tw-text-muted">{summaryText}</p>
          </div>
        </div>

        <div className="tw-mt-3 tw-grid tw-grid-cols-1 tw-gap-3 md:tw-grid-cols-3">
          <div className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3">
            <div className="tw-mb-2 tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-font-medium tw-text-normal">
              <FileText className="tw-size-3.5 tw-text-muted" />
              Vault Context
            </div>
            <ContextPreviewList
              title="Patterns"
              values={inclusions}
              emptyLabel="No inclusion patterns."
            />
          </div>

          <div className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3">
            <div className="tw-mb-2 tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-font-medium tw-text-normal">
              <Globe className="tw-size-3.5 tw-text-muted" />
              Web Sources
            </div>
            <ContextPreviewList title="URLs" values={webUrls} emptyLabel="No web URLs." />
          </div>

          <div className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3">
            <div className="tw-mb-2 tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-font-medium tw-text-normal">
              <Youtube className="tw-size-3.5 tw-text-muted" />
              YouTube
            </div>
            <ContextPreviewList title="Videos" values={youtubeUrls} emptyLabel="No YouTube URLs." />
          </div>
        </div>

        <div className="tw-mt-3">
          <Button
            variant="default"
            size="sm"
            className="tw-w-full tw-gap-2"
            onClick={handleStartChat}
            style={{
              backgroundColor: appearance.color,
              borderColor: appearance.color,
            }}
          >
            <MessageCirclePlus className="tw-size-4" />
            New Chat
          </Button>
        </div>

        <div className="tw-mt-3 tw-flex-1 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3">
          <span className="tw-mb-2 tw-block tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-[0.08em] tw-text-faint">
            Recent Chats {chatHistory.length > 0 ? `(${chatHistory.length})` : ""}
          </span>
          {chatHistory.length === 0 ? (
            <p className="tw-m-0 tw-text-xs tw-text-faint">No conversations yet.</p>
          ) : (
            <div className="tw-flex tw-flex-col tw-gap-1">
              {chatHistory.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  className="tw-flex tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-border-none tw-bg-primary-alt tw-px-2 tw-py-1.5 tw-text-left tw-transition-colors hover:tw-bg-primary-alt/70"
                  onClick={() => onLoadChat(chat.id)}
                >
                  <MessageSquare className="tw-size-3.5 tw-shrink-0 tw-text-faint" />
                  <span className="tw-flex-1 tw-truncate tw-text-xs tw-text-normal">
                    {chat.title}
                  </span>
                  <span className="tw-shrink-0 tw-text-[10px] tw-text-faint">
                    {formatShortDate(chat.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);

ProjectLandingPage.displayName = "ProjectLandingPage";

export { ProjectLandingPage };
