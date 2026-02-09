/* eslint-disable tailwindcss/no-custom-classname */
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
      <div className="hendrik-project-landing tw-flex tw-flex-1 tw-flex-col tw-overflow-y-auto tw-overflow-x-hidden tw-p-3">
        <div
          className="hendrik-project-landing__hero tw-rounded-xl tw-p-4"
          style={{
            background: `linear-gradient(155deg, color-mix(in srgb, ${appearance.color} 18%, transparent), color-mix(in srgb, var(--background-primary) 94%, #f8f4ed 6%) 55%)`,
            border: `1px solid color-mix(in srgb, ${appearance.color} 20%, var(--hendrik-border-soft))`,
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
                <Button variant="ghost2" size="icon" onClick={onEdit} title="Edit project">
                  <Edit2 className="tw-size-3.5" />
                </Button>
              </div>
              {project.description && (
                <p className="tw-m-0 tw-line-clamp-2 tw-text-sm tw-text-muted">
                  {project.description}
                </p>
              )}
              <div className="tw-flex tw-flex-wrap tw-gap-1.5 tw-pt-1">
                <span
                  className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-md tw-px-2 tw-py-0.5 tw-text-[11px] tw-text-muted"
                  style={{ border: "1px solid var(--hendrik-border-soft)" }}
                >
                  {modelLabel}
                </span>
                {totalSources > 0 && (
                  <span
                    className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-md tw-px-2 tw-py-0.5 tw-text-[11px] tw-text-muted"
                    style={{ border: "1px solid var(--hendrik-border-soft)" }}
                  >
                    {totalSources} {totalSources === 1 ? "source" : "sources"}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            className="tw-mt-3 tw-rounded-lg tw-p-3"
            style={{
              border: "1px solid var(--hendrik-border-soft)",
              background: `color-mix(in srgb, var(--background-primary) 92%, #f5ecdd 8%)`,
            }}
          >
            <div className="tw-mb-1 tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-[0.08em] tw-text-faint">
              Summary
            </div>
            <p className="tw-m-0 tw-text-sm tw-text-muted">{summaryText}</p>
          </div>
        </div>

        {totalSources > 0 && (
          <div
            className="hendrik-project-landing__sources tw-mt-3 tw-rounded-lg tw-p-3"
            style={{ border: "1px solid var(--hendrik-border-soft)" }}
          >
            <div className="tw-mb-2 tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-[0.08em] tw-text-faint">
              Context Sources
            </div>
            <div className="tw-flex tw-flex-col tw-gap-2">
              {inclusions.length > 0 && (
                <div className="tw-flex tw-items-start tw-gap-2">
                  <FileText className="tw-mt-0.5 tw-size-3.5 tw-shrink-0 tw-text-faint" />
                  <div className="tw-flex tw-flex-1 tw-flex-wrap tw-gap-1">
                    {inclusions.slice(0, 4).map((value) => (
                      <span
                        key={value}
                        className="tw-truncate tw-rounded-md tw-px-1.5 tw-py-0.5 tw-text-[11px] tw-text-muted"
                        style={{
                          border: "1px solid var(--hendrik-border-soft)",
                          background:
                            "color-mix(in srgb, var(--background-primary) 90%, #f5ecdd 10%)",
                        }}
                        title={value}
                      >
                        {value}
                      </span>
                    ))}
                    {inclusions.length > 4 && (
                      <span className="tw-text-[11px] tw-text-faint">
                        +{inclusions.length - 4} more
                      </span>
                    )}
                  </div>
                </div>
              )}
              {webUrls.length > 0 && (
                <div className="tw-flex tw-items-start tw-gap-2">
                  <Globe className="tw-mt-0.5 tw-size-3.5 tw-shrink-0 tw-text-faint" />
                  <span className="tw-text-xs tw-text-muted">
                    {webUrls.length} web {webUrls.length === 1 ? "source" : "sources"}
                  </span>
                </div>
              )}
              {youtubeUrls.length > 0 && (
                <div className="tw-flex tw-items-start tw-gap-2">
                  <Youtube className="tw-mt-0.5 tw-size-3.5 tw-shrink-0 tw-text-faint" />
                  <span className="tw-text-xs tw-text-muted">
                    {youtubeUrls.length} {youtubeUrls.length === 1 ? "video" : "videos"}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="hendrik-project-landing__new-chat tw-mt-3">
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

        <div
          className="hendrik-project-landing__recent tw-mt-3 tw-flex-1 tw-rounded-lg tw-p-3"
          style={{ border: "1px solid var(--hendrik-border-soft)" }}
        >
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
                  className="tw-flex tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-border-none tw-px-2 tw-py-1.5 tw-text-left tw-transition-colors"
                  style={{
                    background: "color-mix(in srgb, var(--background-primary) 90%, #f5ecdd 10%)",
                  }}
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
