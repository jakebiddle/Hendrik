import {
  consumePendingSettingsTab,
  openHendrikSettings,
  setPendingSettingsTab,
} from "@/settings/v2/settingsNavigation";

describe("settingsNavigation", () => {
  test("returns default tab when no pending tab is set", () => {
    expect(consumePendingSettingsTab("general")).toBe("general");
  });

  test("returns pending tab once and clears it", () => {
    setPendingSettingsTab("search");

    expect(consumePendingSettingsTab("general")).toBe("search");
    expect(consumePendingSettingsTab("general")).toBe("general");
  });

  test("opens hendrik settings and stores pending tab", () => {
    const display = jest.fn();
    const openTabById = jest.fn().mockReturnValue({ display });
    (global as unknown as { app: unknown }).app = {
      setting: {
        openTabById,
      },
    };

    openHendrikSettings("ai");

    expect(openTabById).toHaveBeenCalledWith("hendrik");
    expect(display).toHaveBeenCalled();
    expect(consumePendingSettingsTab("general")).toBe("ai");
  });
});
