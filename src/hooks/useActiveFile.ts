import { TFile } from "obsidian";
import { useEffect, useState } from "react";

/**
 * Hook that tracks the currently active file in Obsidian.
 * Listens to the native workspace `active-leaf-change` event directly
 * (rather than a relayed custom EventTarget) so it always stays in sync.
 */
export function useActiveFile() {
  const [activeFile, setActiveFile] = useState<TFile | null>(() => app.workspace.getActiveFile());

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleActiveLeafChange = () => {
      // Debounce because Obsidian fires the event multiple times per switch
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setActiveFile(app.workspace.getActiveFile());
      }, 100);
    };

    const eventRef = app.workspace.on("active-leaf-change", handleActiveLeafChange);

    return () => {
      clearTimeout(timeoutId);
      // cspell:disable-next-line
      app.workspace.offref(eventRef);
    };
  }, []);

  return activeFile;
}
