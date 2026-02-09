import { Button } from "@/components/ui/button";
import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

interface ConfirmModalContentProps {
  content: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmButtonText: string;
  cancelButtonText: string;
}

/**
 * Shared confirm modal content with redesigned chat UI styling.
 */
function ConfirmModalContent({
  content,
  onConfirm,
  onCancel,
  confirmButtonText,
  cancelButtonText,
}: ConfirmModalContentProps): React.ReactElement {
  return (
    <div className="hendrik-confirm-modal tw-flex tw-flex-col tw-gap-5">
      <div className="hendrik-confirm-modal__content tw-whitespace-pre-wrap">{content}</div>
      <div className="tw-flex tw-justify-end tw-gap-2">
        {cancelButtonText && (
          <Button variant="secondary" onClick={onCancel}>
            {cancelButtonText}
          </Button>
        )}
        {confirmButtonText && (
          <Button variant="default" onClick={onConfirm}>
            {confirmButtonText}
          </Button>
        )}
      </div>
    </div>
  );
}

export class ConfirmModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private onConfirm: () => void,
    private content: string,
    title: string,
    private confirmButtonText: string = "Continue",
    private cancelButtonText: string = "Cancel",
    private styleVariant: "default" | "settings" = "default"
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle(title);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    this.root = createRoot(contentEl);
    modalEl.addClass("hendrik-confirm-modal-shell");
    if (this.styleVariant === "settings") {
      modalEl.addClass("hendrik-settings-modal-shell");
    }

    const handleConfirm = () => {
      this.onConfirm();
      this.close();
    };

    this.root.render(
      <ConfirmModalContent
        content={this.content}
        onConfirm={handleConfirm}
        onCancel={() => this.close()}
        confirmButtonText={this.confirmButtonText}
        cancelButtonText={this.cancelButtonText}
      />
    );
  }

  onClose(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.modalEl.removeClass("hendrik-confirm-modal-shell");
    this.modalEl.removeClass("hendrik-settings-modal-shell");
  }
}
