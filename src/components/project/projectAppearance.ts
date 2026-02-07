import { ProjectConfig } from "@/aiParams";
import {
  BookOpen,
  Briefcase,
  Code2,
  FlaskConical,
  Folder,
  Lightbulb,
  LucideIcon,
  Rocket,
  Shield,
} from "lucide-react";

export interface ProjectColorOption {
  id: string;
  label: string;
  value: string;
}

export interface ProjectIconOption {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const PROJECT_COLOR_OPTIONS: ProjectColorOption[] = [
  { id: "ember", label: "Ember", value: "#B63B1F" },
  { id: "cobalt", label: "Cobalt", value: "#2358C8" },
  { id: "jade", label: "Jade", value: "#1F8A5B" },
  { id: "violet", label: "Violet", value: "#7A4BD4" },
  { id: "slate", label: "Slate", value: "#4B5563" },
  { id: "gold", label: "Gold", value: "#B97A10" },
];

export const PROJECT_ICON_OPTIONS: ProjectIconOption[] = [
  { id: "folder", label: "Folder", icon: Folder },
  { id: "briefcase", label: "Briefcase", icon: Briefcase },
  { id: "code", label: "Code", icon: Code2 },
  { id: "book", label: "Book", icon: BookOpen },
  { id: "lightbulb", label: "Idea", icon: Lightbulb },
  { id: "rocket", label: "Rocket", icon: Rocket },
  { id: "shield", label: "Shield", icon: Shield },
  { id: "lab", label: "Lab", icon: FlaskConical },
];

export interface ResolvedProjectAppearance {
  color: string;
  icon: string;
}

/**
 * Resolves a project color and icon with stable defaults.
 */
export function resolveProjectAppearance(project?: ProjectConfig): ResolvedProjectAppearance {
  const defaultColor = PROJECT_COLOR_OPTIONS[0].value;
  const defaultIcon = PROJECT_ICON_OPTIONS[0].id;

  const resolvedColor = PROJECT_COLOR_OPTIONS.some(
    (option) => option.value === project?.appearance?.color
  )
    ? (project?.appearance?.color as string)
    : defaultColor;

  const resolvedIcon = PROJECT_ICON_OPTIONS.some(
    (option) => option.id === project?.appearance?.icon
  )
    ? (project?.appearance?.icon as string)
    : defaultIcon;

  return {
    color: resolvedColor,
    icon: resolvedIcon,
  };
}

/**
 * Returns the icon component configured for a project.
 */
export function getProjectIconComponent(iconId?: string): LucideIcon {
  const match = PROJECT_ICON_OPTIONS.find((option) => option.id === iconId);
  return match?.icon ?? Folder;
}

/**
 * Builds a concise fallback summary for a project from stored metadata.
 */
export function buildFallbackProjectSummary(project: ProjectConfig): string {
  const context = project.contextSource ?? {};
  const inclusionCount = (context.inclusions ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean).length;
  const webCount = (context.webUrls ?? "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean).length;
  const youtubeCount = (context.youtubeUrls ?? "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean).length;

  const contextParts: string[] = [];
  if (inclusionCount > 0) {
    contextParts.push(`${inclusionCount} vault pattern${inclusionCount > 1 ? "s" : ""}`);
  }
  if (webCount > 0) {
    contextParts.push(`${webCount} web source${webCount > 1 ? "s" : ""}`);
  }
  if (youtubeCount > 0) {
    contextParts.push(`${youtubeCount} YouTube source${youtubeCount > 1 ? "s" : ""}`);
  }

  const scopeSentence =
    contextParts.length > 0
      ? `Context includes ${contextParts.join(", ")}.`
      : "No external context sources configured yet.";

  const promptSentence = project.systemPrompt.trim()
    ? "Custom behavior instructions are configured."
    : "No project-specific behavior instructions yet.";

  return `${scopeSentence} ${promptSentence}`;
}
