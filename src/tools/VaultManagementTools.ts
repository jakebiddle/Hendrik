import { ensureFolderExists } from "@/utils";
import { SemanticRelationProposalStore } from "@/search/entityGraph";
import { normalizePath, TAbstractFile, TFile, TFolder } from "obsidian";
import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";

const MAX_BATCH_NOTE_READ = 25;
const MAX_NOTE_READ_CHARS = 20000;
const DEFAULT_NOTE_READ_CHARS = 6000;

interface NoteResolutionResult {
  status: "resolved" | "not_found" | "ambiguous";
  file?: TFile;
  candidates?: string[];
}

interface FolderResolutionResult {
  status: "resolved" | "not_found" | "ambiguous" | "path_conflict";
  folder?: TFolder;
  candidates?: string[];
}

interface FolderDeleteStats {
  deletedFiles: number;
  deletedFolders: number;
}

/**
 * Normalize a vault-relative path by converting separators and trimming leading/trailing slashes.
 *
 * @param rawPath - Path candidate from user/tool args.
 * @returns Canonical vault-relative path.
 */
function normalizeVaultPath(rawPath: string): string {
  return normalizePath(rawPath).replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Check whether a path string already ends with a file extension.
 *
 * @param path - Candidate file path.
 * @returns True when the last path segment contains an extension.
 */
function hasFileExtension(path: string): boolean {
  return /\.[^/]+$/.test(path);
}

/**
 * Build common note path candidates, including markdown/canvas extension fallbacks.
 *
 * @param notePath - User-provided note path or title.
 * @returns Ordered list of deduplicated path candidates.
 */
function buildNotePathCandidates(notePath: string): string[] {
  const normalized = normalizeVaultPath(notePath.trim());
  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>([normalized]);
  if (!hasFileExtension(normalized)) {
    candidates.add(`${normalized}.md`);
    candidates.add(`${normalized}.canvas`);
  }

  return Array.from(candidates);
}

/**
 * Resolve a note path/title to an existing vault file using direct path checks, link resolution, and basename fallback.
 *
 * @param notePath - Path or title provided by the caller.
 * @returns Resolution result containing the file or ambiguity details.
 */
function resolveNoteFile(notePath: string): NoteResolutionResult {
  const candidates = buildNotePathCandidates(notePath);
  if (candidates.length === 0) {
    return { status: "not_found" };
  }

  for (const candidate of candidates) {
    const direct = app.vault.getAbstractFileByPath(candidate);
    if (direct instanceof TFile) {
      return { status: "resolved", file: direct };
    }
  }

  for (const candidate of candidates) {
    const resolved = app.metadataCache.getFirstLinkpathDest?.(candidate, "");
    if (resolved instanceof TFile) {
      return { status: "resolved", file: resolved };
    }
  }

  const allFiles = app.vault
    .getFiles()
    .filter((file) => file.extension === "md" || file.extension === "canvas");
  const targetBasename = candidates[0].split("/").pop()?.toLowerCase() || "";
  if (!targetBasename) {
    return { status: "not_found" };
  }

  const basenameNoExt = targetBasename.replace(/\.[^/.]+$/, "");
  const basenameMatches = allFiles.filter((file) => file.basename.toLowerCase() === basenameNoExt);

  if (basenameMatches.length === 1) {
    return { status: "resolved", file: basenameMatches[0] };
  }

  if (basenameMatches.length > 1) {
    return {
      status: "ambiguous",
      candidates: basenameMatches.map((file) => file.path),
    };
  }

  return { status: "not_found" };
}

/**
 * Resolve a folder path using direct lookup and basename fallback.
 *
 * @param folderPath - Path or folder name.
 * @returns Folder resolution result with ambiguity details when needed.
 */
function resolveFolder(folderPath: string): FolderResolutionResult {
  const normalized = normalizeVaultPath(folderPath.trim());
  if (!normalized) {
    return { status: "not_found" };
  }

  const direct = app.vault.getAbstractFileByPath(normalized);
  if (direct instanceof TFolder) {
    return { status: "resolved", folder: direct };
  }
  if (direct instanceof TFile) {
    return { status: "path_conflict" };
  }

  const folders = app.vault
    .getAllLoadedFiles()
    .filter((entry: TAbstractFile): entry is TFolder => entry instanceof TFolder)
    .filter((entry) => entry.path.length > 0);
  const basename = normalized.split("/").pop()?.toLowerCase() || "";
  const basenameMatches = folders.filter((folder) => folder.name.toLowerCase() === basename);

  if (basenameMatches.length === 1) {
    return { status: "resolved", folder: basenameMatches[0] };
  }

  if (basenameMatches.length > 1) {
    return {
      status: "ambiguous",
      candidates: basenameMatches.map((folder) => folder.path),
    };
  }

  return { status: "not_found" };
}

/**
 * Compute destination path for moving/renaming a note.
 *
 * @param file - Source file being moved.
 * @param newPath - Explicit new path, if provided.
 * @param newName - Optional replacement file name.
 * @param targetFolder - Optional destination folder.
 * @returns Resolved destination path.
 */
function computeNoteDestinationPath(
  file: TFile,
  newPath?: string,
  newName?: string,
  targetFolder?: string
): string {
  if (newPath) {
    const normalizedNewPath = normalizeVaultPath(newPath);
    if (!hasFileExtension(normalizedNewPath)) {
      return `${normalizedNewPath}.${file.extension}`;
    }
    return normalizedNewPath;
  }

  const parentFolder = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";
  const destinationFolder = targetFolder ? normalizeVaultPath(targetFolder) : parentFolder;
  const sourceName = file.name;
  const nextName = (newName || sourceName).trim();
  const normalizedName = hasFileExtension(nextName) ? nextName : `${nextName}.${file.extension}`;

  return destinationFolder ? `${destinationFolder}/${normalizedName}` : normalizedName;
}

/**
 * Compute a fuzzy title match score between a note and query text.
 *
 * @param query - Query text.
 * @param file - Candidate file.
 * @returns Score in [0, 1], where 0 means no match.
 */
function computeTitleMatchScore(query: string, file: TFile): number {
  const q = query.trim().toLowerCase();
  const basename = file.basename.toLowerCase();
  const fullPath = file.path.toLowerCase();
  if (!q) {
    return 0;
  }

  if (basename === q) {
    return 1;
  }
  if (basename.startsWith(q)) {
    return 0.9;
  }
  if (basename.includes(q)) {
    return 0.8;
  }
  if (fullPath.includes(q)) {
    return 0.65;
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return 0;
  }
  const tokenHits = tokens.filter(
    (token) => basename.includes(token) || fullPath.includes(token)
  ).length;
  if (tokenHits === 0) {
    return 0;
  }

  return Math.min(0.6, tokenHits / tokens.length);
}

/**
 * Recursively delete a folder tree and collect deletion counts.
 *
 * @param folder - Folder to delete.
 * @returns Aggregate deletion statistics.
 */
async function deleteFolderTree(folder: TFolder): Promise<FolderDeleteStats> {
  let deletedFiles = 0;
  let deletedFolders = 0;
  const children = [...folder.children];

  for (const child of children) {
    if (child instanceof TFolder) {
      const stats = await deleteFolderTree(child);
      deletedFiles += stats.deletedFiles;
      deletedFolders += stats.deletedFolders;
      continue;
    }
    await app.vault.delete(child);
    deletedFiles += 1;
  }

  await app.vault.delete(folder);
  deletedFolders += 1;

  return { deletedFiles, deletedFolders };
}

const findNotesByTitleSchema = z.object({
  query: z.string().min(1).describe("Title/path query to match notes by name."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Maximum number of matches to return."),
  includeCanvas: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether .canvas files should be included in matching."),
});

const batchReadNotesSchema = z.object({
  notePaths: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_BATCH_NOTE_READ)
    .describe("List of note paths/titles to read in one request."),
  maxCharsPerNote: z
    .number()
    .int()
    .min(100)
    .max(MAX_NOTE_READ_CHARS)
    .optional()
    .default(DEFAULT_NOTE_READ_CHARS)
    .describe("Maximum characters returned per note to keep payload bounded."),
});

const getBacklinksSchema = z.object({
  notePath: z.string().min(1).describe("Path/title of the note to inspect backlinks for."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe("Maximum backlinks to return."),
});

const upsertFrontmatterSchema = z.object({
  notePath: z.string().min(1).describe("Markdown note path/title to update frontmatter on."),
  patch: z
    .record(z.any())
    .optional()
    .default({})
    .describe("Frontmatter key/value pairs to add or update."),
  removeKeys: z
    .array(z.string().min(1))
    .optional()
    .default([])
    .describe("Frontmatter keys to remove."),
});

const moveOrRenameNoteSchema = z
  .object({
    notePath: z.string().min(1).describe("Existing note path/title to move or rename."),
    newPath: z
      .string()
      .optional()
      .describe("Optional full destination path. If omitted, newName/targetFolder are used."),
    newName: z.string().optional().describe("Optional destination file name."),
    targetFolder: z.string().optional().describe("Optional destination folder path."),
  })
  .describe("Move and/or rename a note in one operation.");

const createFolderSchema = z.object({
  folderPath: z.string().min(1).describe("Vault-relative folder path to create."),
});

const renameFolderSchema = z.object({
  folderPath: z.string().min(1).describe("Existing folder path/name to rename."),
  newName: z.string().min(1).describe("New folder name (single segment, no slash characters)."),
});

const moveFolderSchema = z.object({
  folderPath: z.string().min(1).describe("Existing folder path/name to move."),
  targetParentPath: z
    .string()
    .describe("Destination parent folder path. Use empty string for vault root."),
  newName: z
    .string()
    .optional()
    .describe("Optional new folder name while moving. Defaults to current folder name."),
});

const deleteFolderSchema = z.object({
  folderPath: z.string().min(1).describe("Existing folder path/name to delete."),
  recursive: z
    .boolean()
    .optional()
    .default(true)
    .describe("Delete all nested files/folders recursively when true."),
  confirmation: z
    .boolean()
    .optional()
    .default(false)
    .describe("Must be true to confirm destructive folder deletion."),
});

const submitSemanticRelationProposalsSchema = z.object({
  proposals: z
    .array(
      z.object({
        notePath: z.string().min(1).describe("Source note path for this relation proposal."),
        predicate: z.string().min(1).describe("Canonical or alias semantic predicate label."),
        targetPath: z.string().min(1).describe("Target note path for this relation proposal."),
        confidence: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("Optional confidence score as 0-100 percentage."),
        sourceField: z
          .string()
          .optional()
          .describe("Optional source field label to retain proposal provenance."),
      })
    )
    .min(1)
    .max(500)
    .describe("Semantic relation proposals to stage for the batch editor."),
});

export const findNotesByTitleTool = createLangChainTool({
  name: "findNotesByTitle",
  description: "Find notes by title/path similarity without reading note content.",
  schema: findNotesByTitleSchema,
  func: async ({ query, limit, includeCanvas }) => {
    const files = app.vault
      .getFiles()
      .filter((file) => file.extension === "md" || (includeCanvas && file.extension === "canvas"));

    const matches = files
      .map((file) => ({
        file,
        score: computeTitleMatchScore(query, file),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
      .slice(0, limit)
      .map((entry) => ({
        path: entry.file.path,
        title: entry.file.basename,
        extension: entry.file.extension,
        score: Number(entry.score.toFixed(3)),
      }));

    return {
      type: "title_search",
      query,
      totalMatches: matches.length,
      results: matches,
    };
  },
});

export const batchReadNotesTool = createLangChainTool({
  name: "batchReadNotes",
  description: "Read multiple notes in one tool call with bounded content per note.",
  schema: batchReadNotesSchema,
  func: async ({ notePaths, maxCharsPerNote }) => {
    const results = [];

    for (const rawPath of notePaths) {
      const resolution = resolveNoteFile(rawPath);
      if (resolution.status === "not_found") {
        results.push({
          requestedPath: rawPath,
          status: "not_found",
        });
        continue;
      }

      if (resolution.status === "ambiguous") {
        results.push({
          requestedPath: rawPath,
          status: "ambiguous",
          candidates: resolution.candidates || [],
        });
        continue;
      }

      const file = resolution.file!;
      const content = await app.vault.cachedRead(file);
      const truncated = content.length > maxCharsPerNote;

      results.push({
        requestedPath: rawPath,
        resolvedPath: file.path,
        title: file.basename,
        status: "ok",
        truncated,
        totalChars: content.length,
        content: truncated ? content.slice(0, maxCharsPerNote) : content,
      });
    }

    return {
      type: "batch_note_read",
      count: results.length,
      results,
    };
  },
});

export const getBacklinksTool = createLangChainTool({
  name: "getBacklinks",
  description: "Get notes that link to a target note.",
  schema: getBacklinksSchema,
  func: async ({ notePath, limit }) => {
    const resolution = resolveNoteFile(notePath);
    if (resolution.status !== "resolved") {
      return {
        status: resolution.status,
        notePath,
        candidates: resolution.candidates || [],
      };
    }

    const file = resolution.file!;
    const backlinks =
      app.metadataCache.getBacklinksForFile(file)?.data ?? new Map<string, unknown>();

    const matches = Array.from(backlinks.keys())
      .map((sourcePath) => app.vault.getAbstractFileByPath(sourcePath))
      .filter((entry): entry is TFile => entry instanceof TFile)
      .slice(0, limit)
      .map((entry) => ({
        path: entry.path,
        title: entry.basename,
      }));

    return {
      status: "ok",
      notePath: file.path,
      totalBacklinks: backlinks.size,
      returned: matches.length,
      backlinks: matches,
    };
  },
});

export const upsertFrontmatterTool = createLangChainTool({
  name: "upsertFrontmatter",
  description: "Add, update, or remove frontmatter fields on a markdown note.",
  schema: upsertFrontmatterSchema,
  func: async ({ notePath, patch, removeKeys }) => {
    const resolution = resolveNoteFile(notePath);
    if (resolution.status !== "resolved") {
      return {
        status: resolution.status,
        notePath,
        candidates: resolution.candidates || [],
      };
    }

    const file = resolution.file!;
    if (file.extension !== "md") {
      return {
        status: "unsupported_file_type",
        notePath: file.path,
        message: "Frontmatter updates are only supported for markdown notes.",
      };
    }

    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const key of removeKeys) {
        delete frontmatter[key];
      }
      for (const [key, value] of Object.entries(patch)) {
        frontmatter[key] = value;
      }
    });

    return {
      status: "updated",
      notePath: file.path,
      updatedKeys: Object.keys(patch),
      removedKeys: removeKeys,
    };
  },
});

export const submitSemanticRelationProposalsTool = createLangChainTool({
  name: "submitSemanticRelationProposals",
  description:
    "Submit AI-extracted semantic relation proposals into Hendrik's editable semantic batch editor queue.",
  schema: submitSemanticRelationProposalsSchema,
  func: async ({ proposals }) => {
    const store = SemanticRelationProposalStore.getInstance();
    const acceptedCount = store.ingestProposals(proposals, "tool:submitSemanticRelationProposals");
    const totalBuffered = store.getAllProposals().length;

    return {
      type: "semantic_relation_proposals",
      submitted: proposals.length,
      accepted: acceptedCount,
      totalBuffered,
      status: acceptedCount > 0 ? "queued" : "no_valid_proposals",
      message:
        acceptedCount > 0
          ? "Proposals queued for manual review in Semantic Batch Editor."
          : "No valid proposals were accepted.",
    };
  },
});

export const moveOrRenameNoteTool = createLangChainTool({
  name: "moveOrRenameNote",
  description: "Move and/or rename an existing note.",
  schema: moveOrRenameNoteSchema,
  func: async ({ notePath, newPath, newName, targetFolder }) => {
    const resolution = resolveNoteFile(notePath);
    if (resolution.status !== "resolved") {
      return {
        status: resolution.status,
        notePath,
        candidates: resolution.candidates || [],
      };
    }

    if (!newPath && !newName && targetFolder === undefined) {
      return {
        status: "invalid_request",
        message: "Provide at least one of newPath, newName, or targetFolder.",
      };
    }

    if (newPath && (newName || targetFolder !== undefined)) {
      return {
        status: "invalid_request",
        message: "Use either newPath or (newName/targetFolder), not both.",
      };
    }

    const file = resolution.file!;
    const destinationPath = computeNoteDestinationPath(file, newPath, newName, targetFolder);

    if (destinationPath === file.path) {
      return {
        status: "no_op",
        notePath: file.path,
      };
    }

    const parentFolderPath = destinationPath.includes("/")
      ? destinationPath.slice(0, destinationPath.lastIndexOf("/"))
      : "";
    if (parentFolderPath) {
      await ensureFolderExists(parentFolderPath);
    }

    const existing = app.vault.getAbstractFileByPath(destinationPath);
    if (existing && existing.path !== file.path) {
      return {
        status: "destination_exists",
        destinationPath,
      };
    }

    const sourcePath = file.path;
    await app.vault.rename(file, destinationPath);

    return {
      status: "moved",
      sourcePath,
      destinationPath,
    };
  },
});

export const createFolderTool = createLangChainTool({
  name: "createFolder",
  description: "Create a folder (including missing parent folders) in the vault.",
  schema: createFolderSchema,
  func: async ({ folderPath }) => {
    const normalized = normalizeVaultPath(folderPath);
    if (!normalized) {
      return {
        status: "invalid_path",
        message: "folderPath cannot be empty.",
      };
    }

    const existing = app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFolder) {
      return {
        status: "already_exists",
        folderPath: existing.path,
      };
    }
    if (existing instanceof TFile) {
      return {
        status: "path_conflict",
        folderPath: normalized,
      };
    }

    await ensureFolderExists(normalized);

    return {
      status: "created",
      folderPath: normalized,
    };
  },
});

export const renameFolderTool = createLangChainTool({
  name: "renameFolder",
  description: "Rename an existing folder while keeping it in the same parent folder.",
  schema: renameFolderSchema,
  func: async ({ folderPath, newName }) => {
    const resolution = resolveFolder(folderPath);
    if (resolution.status !== "resolved") {
      return {
        status: resolution.status,
        folderPath,
        candidates: resolution.candidates || [],
      };
    }

    if (newName.includes("/")) {
      return {
        status: "invalid_name",
        message: "newName must be a single folder name without '/'.",
      };
    }

    const folder = resolution.folder!;
    if (!folder.parent) {
      return {
        status: "unsupported",
        message: "Vault root folder cannot be renamed.",
      };
    }

    const parentPath = folder.parent.path;
    const destinationPath = parentPath ? `${parentPath}/${newName}` : newName;
    if (destinationPath === folder.path) {
      return { status: "no_op", folderPath: folder.path };
    }

    const existing = app.vault.getAbstractFileByPath(destinationPath);
    if (existing) {
      return {
        status: "destination_exists",
        destinationPath,
      };
    }

    const sourcePath = folder.path;
    await app.vault.rename(folder, destinationPath);

    return {
      status: "renamed",
      sourcePath,
      destinationPath,
    };
  },
});

export const moveFolderTool = createLangChainTool({
  name: "moveFolder",
  description: "Move a folder to a new parent folder, optionally renaming it.",
  schema: moveFolderSchema,
  func: async ({ folderPath, targetParentPath, newName }) => {
    const sourceResolution = resolveFolder(folderPath);
    if (sourceResolution.status !== "resolved") {
      return {
        status: sourceResolution.status,
        folderPath,
        candidates: sourceResolution.candidates || [],
      };
    }

    const sourceFolder = sourceResolution.folder!;
    const targetParentNormalized = normalizeVaultPath(targetParentPath || "");
    if (targetParentNormalized) {
      await ensureFolderExists(targetParentNormalized);
    }

    const targetParentFolder = targetParentNormalized
      ? app.vault.getAbstractFileByPath(targetParentNormalized)
      : app.vault.getRoot();
    if (!(targetParentFolder instanceof TFolder)) {
      return {
        status: "invalid_target_parent",
        targetParentPath: targetParentNormalized,
      };
    }

    const destinationName = (newName || sourceFolder.name).trim();
    if (!destinationName || destinationName.includes("/")) {
      return {
        status: "invalid_name",
        message: "newName must be a single folder name without '/'.",
      };
    }

    const destinationPath = targetParentFolder.path
      ? `${targetParentFolder.path}/${destinationName}`
      : destinationName;

    if (destinationPath === sourceFolder.path) {
      return { status: "no_op", folderPath: sourceFolder.path };
    }

    if (destinationPath.startsWith(`${sourceFolder.path}/`)) {
      return {
        status: "invalid_target_parent",
        message: "Cannot move a folder into one of its own descendants.",
      };
    }

    const existing = app.vault.getAbstractFileByPath(destinationPath);
    if (existing) {
      return {
        status: "destination_exists",
        destinationPath,
      };
    }

    const sourcePath = sourceFolder.path;
    await app.vault.rename(sourceFolder, destinationPath);

    return {
      status: "moved",
      sourcePath,
      destinationPath,
    };
  },
});

export const deleteFolderTool = createLangChainTool({
  name: "deleteFolder",
  description: "Delete a folder (optionally recursive). Requires explicit confirmation.",
  schema: deleteFolderSchema,
  func: async ({ folderPath, recursive, confirmation }) => {
    if (!confirmation) {
      return {
        status: "requires_confirmation",
        message: "Set confirmation=true to confirm folder deletion.",
      };
    }

    const resolution = resolveFolder(folderPath);
    if (resolution.status !== "resolved") {
      return {
        status: resolution.status,
        folderPath,
        candidates: resolution.candidates || [],
      };
    }

    const folder = resolution.folder!;
    if (!folder.parent) {
      return {
        status: "unsupported",
        message: "Vault root folder cannot be deleted.",
      };
    }

    if (!recursive && folder.children.length > 0) {
      return {
        status: "not_empty",
        folderPath: folder.path,
        message: "Folder contains files/folders. Set recursive=true to delete all contents.",
      };
    }

    if (!recursive) {
      await app.vault.delete(folder);
      return {
        status: "deleted",
        folderPath: folder.path,
        deletedFiles: 0,
        deletedFolders: 1,
      };
    }

    const sourcePath = folder.path;
    const stats = await deleteFolderTree(folder);
    return {
      status: "deleted",
      folderPath: sourcePath,
      deletedFiles: stats.deletedFiles,
      deletedFolders: stats.deletedFolders,
    };
  },
});
