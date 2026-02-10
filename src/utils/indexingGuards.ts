import { getSettings } from "@/settings/model";
import { Platform } from "obsidian";

/**
 * Determine whether automatic indexing actions are allowed for the current device.
 * Auto indexing is blocked on mobile when the user disables it in settings.
 *
 * @returns True when auto indexing should run, false when it should be skipped.
 */
export function shouldRunAutoIndexing(): boolean {
  const settings = getSettings();
  return !(Platform.isMobile && settings.disableAutoIndexOnMobile);
}
