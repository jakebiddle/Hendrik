import { extractAppIgnoreSettings } from "@/search/searchUtils";
import { App } from "obsidian";
import { BaseSearchableModal } from "@/components/modals/BaseSearchableModal";

/**
 * Searchable modal for selecting a vault folder.
 */
export class FolderSearchModal extends BaseSearchableModal<string> {
  constructor(
    app: App,
    private onChooseFolder: (folder: string) => void
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Select Folder");
  }

  protected getItems(): string[] {
    const folderSet = new Set<string>();
    const ignoredFolders = extractAppIgnoreSettings(this.app);

    this.app.vault.getAllLoadedFiles().forEach((file) => {
      if (file.parent?.path && file.parent.path !== "/") {
        const shouldInclude = !ignoredFolders.some(
          (ignored) => file.parent!.path === ignored || file.parent!.path.startsWith(`${ignored}/`)
        );

        if (shouldInclude) {
          folderSet.add(file.parent.path);
        }
      }
    });

    return Array.from(folderSet).sort((a, b) => a.localeCompare(b));
  }

  protected getItemKey(folder: string): string {
    return folder;
  }

  protected getItemLabel(folder: string): string {
    return folder;
  }

  protected getSearchPlaceholder(): string {
    return "Search folders...";
  }

  protected getEmptyMessage(): string {
    return "No folders found.";
  }

  protected onChooseItem(folder: string): void {
    this.onChooseFolder(folder);
  }
}
