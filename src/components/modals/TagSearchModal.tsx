import { getTagsFromNote } from "@/utils";
import { App } from "obsidian";
import { BaseSearchableModal } from "@/components/modals/BaseSearchableModal";

/**
 * Searchable modal for selecting a vault tag.
 */
export class TagSearchModal extends BaseSearchableModal<string> {
  constructor(
    app: App,
    private onChooseTag: (tag: string) => void
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Select Tag");
  }

  protected getItems(): string[] {
    const files = this.app.vault.getMarkdownFiles();
    const tagSet = new Set<string>();

    for (const file of files) {
      const tags = getTagsFromNote(file);
      tags.forEach((tag) => tagSet.add(tag));
    }

    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }

  protected getItemKey(tag: string): string {
    return tag;
  }

  protected getItemLabel(tag: string): string {
    return tag;
  }

  protected getSearchPlaceholder(): string {
    return "Search tags...";
  }

  protected getEmptyMessage(): string {
    return "No tags found.";
  }

  protected onChooseItem(tag: string): void {
    this.onChooseTag(tag);
  }
}
