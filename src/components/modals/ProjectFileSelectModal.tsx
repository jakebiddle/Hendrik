import { App, TFile } from "obsidian";
import { BaseSearchableModal } from "@/components/modals/BaseSearchableModal";

interface ProjectFileSelectModalProps {
  app: App;
  onFileSelect: (file: TFile) => void;
  excludeFilePaths: string[];
  titleOnly?: boolean;
}

/**
 * Searchable project file picker with recent-file prioritization.
 */
export class ProjectFileSelectModal extends BaseSearchableModal<TFile> {
  private readonly onFileSelect: (file: TFile) => void;
  private readonly titleOnly: boolean;
  private readonly activeNote: TFile | null;
  private readonly availableFiles: TFile[];

  constructor({
    app,
    onFileSelect,
    excludeFilePaths,
    titleOnly = false,
  }: ProjectFileSelectModalProps) {
    super(app);
    this.onFileSelect = onFileSelect;
    this.titleOnly = titleOnly;
    this.activeNote = app.workspace.getActiveFile();
    this.availableFiles = this.getOrderedProjectFiles(excludeFilePaths);

    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Select File");
  }

  /**
   * Builds ordered file candidates with current note + recents first.
   */
  private getOrderedProjectFiles(excludeFilePaths: string[]): TFile[] {
    const excludedExtensions = ["mp3", "mp4", "m4a", "wav", "webm"];

    const recentFiles = this.app.workspace
      .getLastOpenFiles()
      .map((filePath) => this.app.vault.getAbstractFileByPath(filePath))
      .filter(
        (file): file is TFile =>
          file instanceof TFile &&
          !excludeFilePaths.includes(file.path) &&
          file.path !== this.activeNote?.path &&
          !excludedExtensions.includes(file.extension.toLowerCase())
      );

    const allFiles = this.app.vault
      .getFiles()
      .filter((file) => !excludedExtensions.includes(file.extension.toLowerCase()));

    const otherFiles = allFiles.filter(
      (file) =>
        !recentFiles.some((recent) => recent.path === file.path) &&
        !excludeFilePaths.includes(file.path) &&
        file.path !== this.activeNote?.path
    );

    const activeNoteArray = this.activeNote ? [this.activeNote] : [];
    return [...activeNoteArray, ...recentFiles, ...otherFiles];
  }

  protected getItems(): TFile[] {
    if (!this.titleOnly) {
      return this.availableFiles;
    }

    const uniqueFiles = new Map<string, TFile>();
    this.availableFiles.forEach((file) => {
      uniqueFiles.set(file.basename, file);
    });

    return Array.from(uniqueFiles.values());
  }

  protected getItemKey(file: TFile): string {
    return file.path;
  }

  protected getItemLabel(file: TFile): string {
    const isActive = file.path === this.activeNote?.path;
    let label = file.basename;
    if (isActive) {
      label += " (current)";
    }
    if (file.extension) {
      label += ` (${file.extension.toUpperCase()})`;
    }
    return label;
  }

  protected getItemDescription(file: TFile): string {
    return file.path;
  }

  protected getItemSearchText(file: TFile): string {
    return `${file.basename} ${file.path} ${file.extension}`;
  }

  protected getSearchPlaceholder(): string {
    return "Search files...";
  }

  protected getEmptyMessage(): string {
    return "No files found.";
  }

  protected onChooseItem(file: TFile): void {
    this.onFileSelect(file);
  }
}
