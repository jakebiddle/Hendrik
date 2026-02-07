import { ProjectConfig } from "@/aiParams";
import { ProjectForm } from "@/components/project/ProjectForm";
import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

/**
 * Legacy Obsidian modal wrapper for project form.
 * Kept for compatibility with any extension points still using modal-based flow.
 */
export class AddProjectModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private onSave: (project: ProjectConfig) => Promise<void>,
    private initialProject?: ProjectConfig
  ) {
    super(app);
  }

  /**
   * Mount the React project form into the modal container.
   */
  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleSave = async (project: ProjectConfig) => {
      await this.onSave(project);
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <ProjectForm
        initialProject={this.initialProject}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  /**
   * Unmount React root when modal closes.
   */
  onClose() {
    this.root.unmount();
  }
}
