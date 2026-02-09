import { ProjectConfig, setCurrentProject } from "@/aiParams";
import {
  resolveEmptyStateSubtitle,
  resolveEmptyStateTitle,
  resolveRoyalAddress,
} from "@/components/chat-components/companionTone";
import { useActiveNoteInsight } from "@/components/chat-components/hooks/useActiveNoteInsight";
import { ProjectLandingPage } from "@/components/chat-components/ProjectLandingPage";
import { ProjectForm } from "@/components/project/ProjectForm";
import {
  getProjectIconComponent,
  resolveProjectAppearance,
} from "@/components/project/projectAppearance";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { useChatInput } from "@/context/ChatInputContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { RecentUsageManager, sortByStrategy } from "@/utils/recentUsageManager";
import { ChevronDown, ChevronUp, Edit2, LibraryBig, Plus, Search, Trash2, X } from "lucide-react";
import { App, Notice } from "obsidian";
import React, { memo, useEffect, useMemo, useState } from "react";
import { filterProjects } from "@/utils/projectUtils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Subscribe to a {@link RecentUsageManager} revision so in-memory touches can trigger
 * re-sorting even when the backing list reference stays unchanged (e.g. when persistence
 * is throttled).
 */
function useRecentUsageManagerRevision<Key extends string>(
  manager: RecentUsageManager<Key> | null | undefined
): number {
  const [revision, setRevision] = useState(() => manager?.getRevision() ?? 0);

  useEffect(() => {
    if (!manager) {
      setRevision(0);
      return;
    }

    setRevision(manager.getRevision());

    return manager.subscribe(() => {
      setRevision(manager.getRevision());
    });
  }, [manager]);

  return revision;
}

/**
 * Counts total context sources for a project.
 */
function countContextSources(project: ProjectConfig): number {
  const inclusions = (project.contextSource?.inclusions ?? "")
    .split(",")
    .filter((s) => s.trim()).length;
  const webUrls = (project.contextSource?.webUrls ?? "").split("\n").filter((s) => s.trim()).length;
  const youtubeUrls = (project.contextSource?.youtubeUrls ?? "")
    .split("\n")
    .filter((s) => s.trim()).length;
  return inclusions + webUrls + youtubeUrls;
}

/**
 * Formats a timestamp as a compact relative time label.
 */
function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ProjectItem({
  app,
  project,
  loadContext,
  onEdit,
  onDelete,
}: {
  app: App;
  project: ProjectConfig;
  loadContext: (project: ProjectConfig) => void;
  onEdit: (project: ProjectConfig) => void;
  onDelete: (project: ProjectConfig) => void;
}) {
  const appearance = resolveProjectAppearance(project);
  const ProjectIcon = getProjectIconComponent(appearance.icon);
  const sourceCount = countContextSources(project);
  const lastUsedLabel = formatRelativeTime(project.UsageTimestamps);

  return (
    <div
      className="hendrik-project-list-item tw-group tw-flex tw-cursor-pointer tw-items-center tw-gap-0 tw-rounded-lg tw-transition-colors tw-duration-150"
      onClick={() => loadContext(project)}
    >
      {/* Accent bar */}
      <div
        className="tw-w-[3px] tw-shrink-0 tw-self-stretch tw-rounded-l-lg"
        style={{ backgroundColor: `color-mix(in srgb, ${appearance.color} 50%, transparent)` }}
      />
      <div className="tw-flex tw-flex-1 tw-items-center tw-justify-between tw-gap-2 tw-p-2.5">
        <div className="tw-flex tw-flex-1 tw-items-center tw-gap-2.5 tw-overflow-hidden">
          <div
            className="tw-flex tw-size-8 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-lg"
            style={{
              backgroundColor: `color-mix(in srgb, ${appearance.color} 15%, transparent)`,
              color: appearance.color,
            }}
          >
            <ProjectIcon className="tw-size-4" />
          </div>
          <div className="tw-flex tw-flex-1 tw-flex-col tw-gap-0.5 tw-overflow-hidden">
            <span className="tw-w-full tw-truncate tw-text-sm tw-font-medium tw-text-normal">
              {project.name}
            </span>
            {project.description && (
              <span className="tw-w-full tw-truncate tw-text-xs tw-text-faint">
                {project.description}
              </span>
            )}
            <div className="tw-flex tw-items-center tw-gap-2 tw-pt-0.5">
              {sourceCount > 0 && (
                <span className="tw-text-[11px] tw-text-faint">
                  {sourceCount} {sourceCount === 1 ? "source" : "sources"}
                </span>
              )}
              {sourceCount > 0 && lastUsedLabel && (
                <span className="tw-text-[11px] tw-text-faint">·</span>
              )}
              {lastUsedLabel && (
                <span className="tw-text-[11px] tw-text-faint">{lastUsedLabel}</span>
              )}
            </div>
          </div>
        </div>
        <div className="tw-flex tw-flex-row tw-items-center tw-gap-0 tw-opacity-0 tw-transition-opacity tw-duration-150 group-hover:tw-opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(project);
                }}
              >
                <Edit2 className="tw-size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  const modal = new ConfirmModal(
                    app,
                    () => onDelete(project),
                    `Are you sure you want to delete project "${project.name}"?`,
                    "Delete Project"
                  );
                  modal.open();
                }}
              >
                <Trash2 className="tw-size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export const ProjectList = memo(
  ({
    className,
    projects,
    defaultOpen: _defaultOpen = false,
    app,
    plugin,
    onProjectAdded,
    onEditProject,
    hasMessages: _hasMessages = false,
    showChatUI,
    onClose: _onClose,
    onProjectClose,
    onLoadChat,
    backSignal = 0,
    onCanGoBackChange,
    onViewingProjectChange,
  }: {
    className?: string;
    projects: ProjectConfig[];
    defaultOpen?: boolean;
    app: App;
    plugin?: any; // HendrikPlugin, optional for backwards compatibility
    onProjectAdded: (project: ProjectConfig) => void;
    onEditProject: (originP: ProjectConfig, updateP: ProjectConfig) => void;
    hasMessages?: boolean;
    showChatUI: (v: boolean) => void;
    onClose: () => void;
    onProjectClose: () => void;
    onLoadChat?: (id: string) => Promise<void>;
    backSignal?: number;
    onCanGoBackChange?: (canGoBack: boolean) => void;
    onViewingProjectChange?: (project: ProjectConfig | null) => void;
  }): React.ReactElement => {
    const [showChatInput, setShowChatInput] = useState(false);
    const [selectedProject, setSelectedProject] = useState<ProjectConfig | null>(null);
    const [viewingProject, setViewingProject] = useState<ProjectConfig | null>(null);
    const [isProjectHubExpanded, setIsProjectHubExpanded] = useState(true);
    const [projectFormState, setProjectFormState] = useState<{
      mode: "create" | "edit";
      originProject?: ProjectConfig;
    } | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const chatInput = useChatInput();
    const settings = useSettingsValue();
    const activeNote = useActiveNoteInsight();

    const projectHubTitle = useMemo(() => {
      const royalAddress = resolveRoyalAddress({
        userPreferredName: settings.userPreferredName,
        userRoyalTitle: settings.userRoyalTitle,
      });

      return resolveEmptyStateTitle({
        activeNote,
        royalAddress,
        hasMessages: false,
        isGenerating: false,
        lastUserMessage: null,
      });
    }, [activeNote, settings.userPreferredName, settings.userRoyalTitle]);

    const projectHubSubtitle = useMemo(() => {
      const royalAddress = resolveRoyalAddress({
        userPreferredName: settings.userPreferredName,
        userRoyalTitle: settings.userRoyalTitle,
      });

      return resolveEmptyStateSubtitle({
        activeNote,
        royalAddress,
        hasMessages: false,
        isGenerating: false,
        lastUserMessage: null,
      });
    }, [activeNote, settings.userPreferredName, settings.userRoyalTitle]);

    // Get the project usage manager for subscription
    const projectUsageTimestampsManager =
      plugin?.projectManager?.getProjectUsageTimestampsManager?.() as
        | RecentUsageManager<string>
        | undefined;
    const projectUsageRevision = useRecentUsageManagerRevision(projectUsageTimestampsManager);

    /**
     * Report whether there is a meaningful "back" target for project mode header controls.
     */
    useEffect(() => {
      onCanGoBackChange?.(Boolean(showChatInput || viewingProject));
    }, [onCanGoBackChange, showChatInput, viewingProject]);

    /**
     * Notify parent when the currently-viewed project changes (for header display).
     */
    useEffect(() => {
      onViewingProjectChange?.(viewingProject);
    }, [onViewingProjectChange, viewingProject]);

    /**
     * Handle external back requests (from top header back button).
     */
    useEffect(() => {
      if (!backSignal) {
        return;
      }

      if (showChatInput) {
        // In active project chat, back should return to project overview (landing page),
        // not the compact project selector header state.
        if (selectedProject) {
          setViewingProject(selectedProject);
          setShowChatInput(false);
          showChatUI(false);
        } else {
          enableOrDisableProject(false);
        }
        onProjectClose();
        return;
      }

      if (viewingProject) {
        setViewingProject(null);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate external signal effect
    }, [backSignal]);

    // Sort projects based on sort strategy
    // Note: projectUsageRevision triggers re-sort when in-memory timestamps change,
    // even though it's not directly referenced in the callback
    const sortedProjects = useMemo(
      () =>
        sortByStrategy(projects, settings.projectListSortStrategy, {
          getName: (project) => project.name,
          getCreatedAtMs: (project) => project.created,
          getLastUsedAtMs: (project) => {
            // Use effective last used time (prefers in-memory value for immediate UI updates)
            if (projectUsageTimestampsManager) {
              return projectUsageTimestampsManager.getEffectiveLastUsedAt(
                project.id,
                project.UsageTimestamps
              );
            }
            return project.UsageTimestamps;
          },
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- projectUsageRevision triggers re-sort when manager's in-memory state changes
      [
        projects,
        settings.projectListSortStrategy,
        projectUsageTimestampsManager,
        projectUsageRevision,
      ]
    );

    // Filter projects based on search query
    const filteredProjects = useMemo(() => {
      return filterProjects(sortedProjects, searchQuery);
    }, [sortedProjects, searchQuery]);

    /**
     * Close project create/edit form state.
     */
    const closeProjectForm = () => {
      setProjectFormState(null);
    };

    /**
     * Open the in-chat form for creating a project.
     */
    const handleAddProject = () => {
      setProjectFormState({ mode: "create" });
    };

    /**
     * Open the in-chat form for editing a project.
     */
    const handleEditProject = (originProject: ProjectConfig) => {
      setProjectFormState({ mode: "edit", originProject });
    };

    /**
     * Persist project changes coming from the project form.
     */
    const handleProjectFormSave = async (project: ProjectConfig) => {
      if (!projectFormState) {
        return;
      }

      if (projectFormState.mode === "create") {
        await Promise.resolve(onProjectAdded(project));
      } else if (projectFormState.originProject) {
        await Promise.resolve(onEditProject(projectFormState.originProject, project));
        if (selectedProject?.name === projectFormState.originProject.name) {
          setSelectedProject(project);
        }
        if (viewingProject?.name === projectFormState.originProject.name) {
          setViewingProject(project);
        }
      }

      closeProjectForm();
    };

    const handleDeleteProject = (project: ProjectConfig) => {
      const currentProjects = projects || [];
      const newProjectList = currentProjects.filter((p) => p.name !== project.name);

      // If the deleted project is currently selected, close it
      if (selectedProject?.name === project.name) {
        enableOrDisableProject(false);
      }

      // Update the project list in settings
      updateSetting("projectList", newProjectList);
      new Notice(`Project "${project.name}" deleted successfully`);
    };

    const enableOrDisableProject = (enable: boolean, project?: ProjectConfig) => {
      if (!enable) {
        setSelectedProject(null);
        setViewingProject(null);
        setShowChatInput(false);
        showChatUI(false);
        setCurrentProject(null);
        return;
      } else {
        if (!project) {
          logError("Must be exist one project.");
          return;
        }
        setSelectedProject(project);
        setShowChatInput(true);
      }
    };

    const handleLoadContext = (p: ProjectConfig) => {
      setSelectedProject(p);
      setViewingProject(null);
      setShowChatInput(true);
      showChatUI(true);
      setCurrentProject(p);

      setTimeout(() => {
        chatInput.focusInput();
      }, 0);
    };

    /**
     * Opens the project landing page for a given project.
     */
    const handleViewProject = (p: ProjectConfig) => {
      setViewingProject(p);
    };

    /**
     * Handles loading a past chat from the landing page.
     */
    const handleLoadPastChat = (chatId: string) => {
      if (!viewingProject) return;
      setSelectedProject(viewingProject);
      setShowChatInput(true);
      setViewingProject(null);
      showChatUI(true);
      setCurrentProject(viewingProject);
      onLoadChat?.(chatId);
    };

    /**
     * Render a project icon using project-level appearance settings.
     */
    const renderProjectIcon = (project: ProjectConfig, className: string) => {
      const appearance = resolveProjectAppearance(project);
      const Icon = getProjectIconComponent(appearance.icon);
      return <Icon className={className} style={{ color: appearance.color }} />;
    };

    return (
      <div
        className={cn(
          "tw-relative tw-flex tw-h-full tw-min-w-0 tw-flex-col tw-overflow-hidden",
          className
        )}
      >
        {projectFormState && (
          <div className="hendrik-project-form-overlay tw-absolute tw-inset-0 tw-z-modal tw-overflow-y-auto tw-bg-overlay/50 tw-p-2 tw-backdrop-blur-sm">
            <div className="hendrik-project-form-shell tw-mx-auto tw-my-2 tw-w-full tw-max-w-2xl tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-lg">
              <ProjectForm
                initialProject={projectFormState.originProject}
                onSave={handleProjectFormSave}
                onCancel={closeProjectForm}
              />
            </div>
          </div>
        )}
        <div className="tw-flex tw-flex-1 tw-flex-col tw-overflow-y-auto tw-overflow-x-hidden">
          <div className="tw-flex tw-min-h-full tw-min-w-0 tw-flex-col">
            {viewingProject ? (
              <ProjectLandingPage
                project={viewingProject}
                onNewChat={() => handleLoadContext(viewingProject)}
                onLoadChat={handleLoadPastChat}
                onEdit={() => handleEditProject(viewingProject)}
              />
            ) : showChatInput && selectedProject ? (
              <div
                className="hendrik-project-active-bar tw-flex tw-items-center tw-justify-between tw-rounded-lg tw-px-3 tw-py-2"
                style={{
                  background: "var(--background-secondary)",
                  borderBottom: "1px solid var(--background-modifier-border)",
                }}
              >
                <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
                  <Select
                    value={selectedProject.name}
                    onValueChange={(value) => {
                      const project = sortedProjects.find((p) => p.name === value);
                      if (project) {
                        handleLoadContext(project);
                      }
                    }}
                  >
                    <SelectTrigger className="tw-truncate">
                      <SelectValue>
                        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                          {renderProjectIcon(selectedProject, "tw-size-3.5 tw-shrink-0")}
                          <span className="tw-flex-1 tw-truncate tw-text-sm tw-font-medium">
                            {selectedProject.name}
                          </span>
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="tw-truncate">
                      {sortedProjects.map((project) => (
                        <SelectItem
                          key={project.name}
                          value={project.name}
                          className="tw-flex tw-items-center tw-gap-2"
                        >
                          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                            {renderProjectIcon(project, "tw-size-3.5 tw-shrink-0")}
                            <span className="tw-truncate">{project.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="tw-ml-1 tw-flex tw-items-center tw-gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost2"
                        size="icon"
                        onClick={() => handleEditProject(selectedProject)}
                      >
                        <Edit2 className="tw-size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Edit Project</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost2"
                        size="icon"
                        onClick={() => {
                          enableOrDisableProject(false);
                          onProjectClose();
                        }}
                        aria-label="Close Current Project"
                      >
                        <X className="tw-size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Close Project</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ) : (
              <div className="hendrik-project-mode-shell tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
                <div className="hendrik-project-mode-shell__hero tw-flex tw-flex-col tw-items-center tw-justify-center tw-text-center">
                  <div
                    className="hendrik-project-mode-shell__avatar hendrik-chat-empty__avatar"
                    aria-hidden="true"
                  />
                  <h2 className="hendrik-project-mode-shell__title hendrik-chat-empty__title">
                    {projectHubTitle}
                  </h2>
                  <p className="hendrik-project-mode-shell__subtitle hendrik-chat-empty__subtitle">
                    {projectHubSubtitle}
                  </p>
                </div>

                <div className="hendrik-project-hub tw-flex tw-min-h-0 tw-flex-col">
                  <div className="hendrik-project-hub__header tw-flex tw-items-center tw-justify-between tw-gap-2 tw-px-3 tw-py-2.5">
                    <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                      <span className="tw-text-sm tw-font-semibold tw-text-normal">Projects</span>
                      <HelpTooltip
                        content="Manage project-specific context, model, and conversation history."
                        contentClassName="tw-w-64"
                        buttonClassName="tw-size-3.5 tw-text-faint"
                      />
                    </div>
                    <div className="tw-flex tw-items-center tw-gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost2" size="icon" onClick={handleAddProject}>
                            <Plus className="tw-size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">New Project</TooltipContent>
                      </Tooltip>
                      {projects.length > 0 && (
                        <Button
                          variant="ghost2"
                          size="icon"
                          onClick={() => setIsProjectHubExpanded((prev) => !prev)}
                          aria-label={
                            isProjectHubExpanded ? "Collapse projects" : "Expand projects"
                          }
                        >
                          {isProjectHubExpanded ? (
                            <ChevronUp className="tw-size-4" />
                          ) : (
                            <ChevronDown className="tw-size-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>

                  {isProjectHubExpanded && projects.length > 3 && (
                    <div className="hendrik-project-hub__search">
                      <SearchBar
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Search projects..."
                      />
                    </div>
                  )}

                  {isProjectHubExpanded && (
                    <div className="hendrik-project-hub__content tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-overflow-x-hidden">
                      {projects.length === 0 ? (
                        <div className="hendrik-project-hub__empty tw-flex tw-flex-col tw-items-center tw-gap-2 tw-rounded-lg tw-px-4 tw-py-6 tw-text-center">
                          <LibraryBig className="tw-size-9 tw-text-faint/40" />
                          <div className="tw-space-y-1">
                            <p className="tw-m-0 tw-text-sm tw-font-medium tw-text-muted">
                              No projects yet
                            </p>
                            <p className="tw-m-0 tw-text-sm tw-text-faint">
                              Create a project to isolate context, model settings, and chat history.
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="tw-mt-1 tw-gap-1.5"
                            onClick={handleAddProject}
                          >
                            <Plus className="tw-size-3.5" />
                            Create Project
                          </Button>
                        </div>
                      ) : (
                        <div className="hendrik-project-hub__list tw-flex tw-flex-col tw-gap-1.5">
                          {filteredProjects.map((project) => (
                            <ProjectItem
                              key={project.name}
                              app={app}
                              project={project}
                              loadContext={handleViewProject}
                              onEdit={handleEditProject}
                              onDelete={handleDeleteProject}
                            />
                          ))}
                        </div>
                      )}

                      {searchQuery.trim() && filteredProjects.length === 0 && (
                        <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-8 tw-text-faint">
                          <Search className="tw-mb-2 tw-size-6 tw-text-faint/40" />
                          <p className="tw-m-0 tw-text-sm">No matching projects</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

ProjectList.displayName = "ProjectList";
