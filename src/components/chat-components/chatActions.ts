import { getCurrentProject, setProjectLoading } from "@/aiParams";
import { ProjectContextCache } from "@/cache/projectContextCache";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { logError } from "@/logger";
import { Docs4LLMParser } from "@/tools/FileParserManager";
import { isRateLimitError } from "@/utils/rateLimitUtils";
import { Notice } from "obsidian";

/**
 * Refresh the vault's semantic search index.
 */
export async function refreshVaultIndex() {
  try {
    const { getSettings } = await import("@/settings/model");
    const settings = getSettings();

    if (settings.useSmartConnections) {
      new Notice(
        "Smart Connections manages its own index. Use the Smart Connections plugin to refresh."
      );
      return;
    }

    if (settings.enableSemanticSearchV3) {
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(false);
      new Notice(`Semantic search index refreshed with ${count} documents.`);
    } else {
      new Notice("Lexical search builds indexes on demand. No manual indexing required.");
    }
  } catch (error) {
    logError("Error refreshing vault index:", error);
    new Notice("Failed to refresh vault index. Check console for details.");
  }
}

/**
 * Force a full reindex of the vault's semantic search index.
 */
export async function forceReindexVault() {
  try {
    const { getSettings } = await import("@/settings/model");
    const settings = getSettings();

    if (settings.useSmartConnections) {
      new Notice(
        "Smart Connections manages its own index. Use the Smart Connections plugin to rebuild."
      );
      return;
    }

    if (settings.enableSemanticSearchV3) {
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(true);
      new Notice(`Semantic search index rebuilt with ${count} documents.`);
    } else {
      new Notice("Lexical search builds indexes on demand. No manual indexing required.");
    }
  } catch (error) {
    logError("Error force reindexing vault:", error);
    new Notice("Failed to force reindex vault. Check console for details.");
  }
}

/**
 * Reload the context for the currently selected project.
 */
export async function reloadCurrentProject() {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    new Notice("No project is currently selected to reload.");
    return;
  }

  try {
    setProjectLoading(true);

    await ProjectContextCache.getInstance().invalidateMarkdownContext(currentProject, true);

    const plugin = (app as any).plugins.getPlugin("hendrik");
    if (plugin && plugin.projectManager) {
      await plugin.projectManager.getProjectContext(currentProject.id);
      new Notice(`Project context for "${currentProject.name}" reloaded successfully.`);
    } else {
      throw new Error("Hendrik plugin or ProjectManager not available.");
    }
  } catch (error) {
    logError("Error reloading project context:", error);

    if (!isRateLimitError(error)) {
      new Notice("Failed to reload project context. Check console for details.");
    }
  } finally {
    setProjectLoading(false);
  }
}

/**
 * Force rebuild the context for the currently selected project (with confirmation).
 */
export async function forceRebuildCurrentProjectContext() {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    new Notice("No project is currently selected to rebuild.");
    return;
  }

  const modal = new ConfirmModal(
    app,
    async () => {
      try {
        setProjectLoading(true);
        new Notice(
          `Force rebuilding context for project: ${currentProject.name}... This will take some time and re-fetch all data.`,
          10000
        );

        Docs4LLMParser.resetRateLimitNoticeTimer();

        await ProjectContextCache.getInstance().clearForProject(currentProject);
        new Notice(`Cache for project "${currentProject.name}" has been cleared.`);

        const plugin = (app as any).plugins.getPlugin("hendrik");
        if (plugin && plugin.projectManager) {
          await plugin.projectManager.getProjectContext(currentProject.id);
          new Notice(
            `Project context for "${currentProject.name}" rebuilt successfully from scratch.`
          );
        } else {
          throw new Error("Hendrik plugin or ProjectManager not available for rebuild.");
        }
      } catch (error) {
        logError("Error force rebuilding project context:", error);

        if (!isRateLimitError(error)) {
          new Notice("Failed to force rebuild project context. Check console for details.");
        }
      } finally {
        setProjectLoading(false);
      }
    },
    `DANGER: This will permanently delete all cached data (markdown, web URLs, YouTube transcripts, and processed file content) for the project "${currentProject.name}" from both memory and disk. The context will then be rebuilt from scratch, re-fetching all remote data and re-processing all local files. This cannot be undone. Are you absolutely sure?`,
    "Force Rebuild Project Context"
  );
  modal.open();
}
