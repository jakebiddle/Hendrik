import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { App, Modal } from "obsidian";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";

export interface SearchableItemView<T> {
  raw: T;
  key: string;
  label: string;
  description?: string;
  searchText: string;
}

interface SearchableModalContentProps<T> {
  items: SearchableItemView<T>[];
  placeholder: string;
  emptyMessage: string;
  onChoose: (item: T) => void;
  onCancel: () => void;
}

/**
 * Generic searchable list content used by custom picker modals.
 */
export function SearchableModalContent<T>({
  items,
  placeholder,
  emptyMessage,
  onChoose,
  onCancel,
}: SearchableModalContentProps<T>): React.ReactElement {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((item) => item.searchText.includes(normalizedQuery));
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  /**
   * Applies keyboard-driven navigation and selection.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (filteredItems.length === 0) {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const selected = filteredItems[activeIndex] ?? filteredItems[0];
        onChoose(selected.raw);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
    [filteredItems, activeIndex, onCancel, onChoose]
  );

  return (
    <div className="hendrik-searchable-modal tw-flex tw-flex-col tw-gap-3">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus
        className="hendrik-searchable-modal__input"
      />

      <div className="hendrik-searchable-modal__list" role="listbox" aria-label="Search results">
        {filteredItems.length === 0 && (
          <div className="hendrik-searchable-modal__empty">{emptyMessage}</div>
        )}

        {filteredItems.map((item, index) => (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={cn(
              "hendrik-searchable-modal__option",
              index === activeIndex && "hendrik-searchable-modal__option--active"
            )}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onChoose(item.raw)}
          >
            <span className="hendrik-searchable-modal__option-label">{item.label}</span>
            {item.description && (
              <span className="hendrik-searchable-modal__option-description">
                {item.description}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="tw-flex tw-justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Base modal that renders a searchable picker list using React.
 */
export abstract class BaseSearchableModal<T> extends Modal {
  private root: Root | null = null;

  /**
   * Returns candidate items for the picker.
   */
  protected abstract getItems(): T[];

  /**
   * Returns stable unique key for an item.
   */
  protected abstract getItemKey(item: T): string;

  /**
   * Returns primary display label.
   */
  protected abstract getItemLabel(item: T): string;

  /**
   * Handles user selection.
   */
  protected abstract onChooseItem(item: T): void;

  /**
   * Optional secondary text shown under the label.
   */
  protected getItemDescription(_item: T): string | undefined {
    return undefined;
  }

  /**
   * Optional extra searchable text.
   */
  protected getItemSearchText(item: T): string {
    return [this.getItemLabel(item), this.getItemDescription(item)].filter(Boolean).join(" ");
  }

  /**
   * Search input placeholder text.
   */
  protected getSearchPlaceholder(): string {
    return "Search...";
  }

  /**
   * Empty state message.
   */
  protected getEmptyMessage(): string {
    return "No matching items.";
  }

  /**
   * Maps raw items to searchable view models.
   */
  private buildSearchableItems(): SearchableItemView<T>[] {
    return this.getItems().map((item) => ({
      raw: item,
      key: this.getItemKey(item),
      label: this.getItemLabel(item),
      description: this.getItemDescription(item),
      searchText: this.getItemSearchText(item).toLowerCase(),
    }));
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    this.root = createRoot(contentEl);
    modalEl.addClass("hendrik-searchable-modal-shell");

    const items = this.buildSearchableItems();
    const handleChoose = (item: T) => {
      this.onChooseItem(item);
      this.close();
    };

    this.root.render(
      <SearchableModalContent
        items={items}
        placeholder={this.getSearchPlaceholder()}
        emptyMessage={this.getEmptyMessage()}
        onChoose={handleChoose}
        onCancel={() => this.close()}
      />
    );
  }

  onClose(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.modalEl.removeClass("hendrik-searchable-modal-shell");
  }

  constructor(app: App) {
    super(app);
  }
}
