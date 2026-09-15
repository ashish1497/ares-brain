import { getDriveAccessToken } from "../api";

/** Loads Google's Picker JS lazily (only when the Drive tab actually asks
 * for it) rather than on every page load — most sessions never touch it. */
function loadGapi(): Promise<void> {
  const w = window as unknown as { gapi?: unknown };
  if (w.gapi) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed to load Google API script"));
    document.head.appendChild(script);
  });
}

function loadPicker(): Promise<void> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).gapi.load("picker", { callback: resolve, onerror: reject });
  });
}

export class DrivePickerError extends Error {}

/**
 * Opens Google's Picker widget restricted to folders, authorized with an
 * OAuth access token minted SERVER-SIDE from the same Desktop-client
 * credentials the rest of this app already has (GET /api/drive/access-token)
 * — no second OAuth consent, no new GCP client. Resolves with the picked
 * folder's Drive ID, or null if the user cancelled.
 */
export async function pickDriveFolder(): Promise<string | null> {
  const { token } = await getDriveAccessToken();
  if (!token) {
    throw new DrivePickerError(
      "No Drive access token available — check Settings that Drive is connected.",
    );
  }
  await loadGapi();
  await loadPicker();

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google;
    try {
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true);
      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setCallback((data: { action: string; docs?: { id: string }[] }) => {
          if (data.action === google.picker.Action.PICKED && data.docs?.[0]) {
            resolve(data.docs[0].id);
          } else if (data.action === google.picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      reject(e instanceof Error ? e : new DrivePickerError(String(e)));
    }
  });
}
