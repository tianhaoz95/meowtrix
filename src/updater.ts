// Helper module for managing Tauri v2 updates.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateProgressCallback = (statusText: string, percent?: number) => void;

/**
 * Checks GitHub Releases (via the endpoint configured in tauri.conf.json) for a new version.
 * Returns the Update object if a newer version is available, or null if already up to date.
 */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    const update = await check();
    return update;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to check for updates: ${message}`);
  }
}

/**
 * Downloads and installs the given update, reporting progress along the way,
 * then relaunches the application.
 */
export async function downloadAndInstallUpdate(
  update: Update,
  onProgress?: UpdateProgressCallback
): Promise<void> {
  let downloadedBytes = 0;
  let totalBytes = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        totalBytes = event.data.contentLength ?? 0;
        onProgress?.("Downloading update…", 0);
        break;
      case "Progress":
        downloadedBytes += event.data.chunkLength;
        if (totalBytes > 0) {
          const percent = Math.round((downloadedBytes / totalBytes) * 100);
          onProgress?.(`Downloading update… ${percent}%`, percent);
        } else {
          const mb = (downloadedBytes / 1_000_000).toFixed(1);
          onProgress?.(`Downloading update… ${mb} MB`);
        }
        break;
      case "Finished":
        onProgress?.("Installing update…", 100);
        break;
    }
  });

  onProgress?.("Restarting application…");
  // Give the OS a moment to finish file swap before triggering relaunch
  await relaunchWithTimeout(5000);
}

/**
 * Relaunches the app, falling back to process exit if relaunch hangs.
 */
async function relaunchWithTimeout(timeoutMs: number): Promise<void> {
  const timer = setTimeout(() => {
    // If relaunch() didn't terminate the process within timeoutMs, force exit
    window.close();
  }, timeoutMs);

  try {
    await relaunch();
  } finally {
    clearTimeout(timer);
  }
}
