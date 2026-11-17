/**
 * The app's version and the check for a newer one: the latest release of the GitHub repository (its tag, `v1.2.0` or `1.2.0`), compared
 * number by number with the version the app was built as.
 */
import { getVersion } from "@tauri-apps/api/app";

export const RELEASES_PAGE = "https://github.com/getgrenade/tf2-workbench/releases";
const LATEST_API = "https://api.github.com/repos/getgrenade/tf2-workbench/releases/latest";

/** The version the app was built as (tauri.conf.json), "" when it cannot be read. */
export const appVersion = (): Promise<string> => getVersion().catch(() => "");

/** The numbers of a version or tag (`v0.2.10-beta` -> [0, 2, 10]); empty when it has none. */
export function versionParts(version: string): number[] {
  const m = version.trim().replace(/^v/i, "").match(/^\d+(\.\d+)*/);
  return m ? m[0].split(".").map(Number) : [];
}

/** Whether `latest` is a newer version than `current` (missing numbers count as 0); false when either has no numbers. */
export function isNewer(latest: string, current: string): boolean {
  const a = versionParts(latest), b = versionParts(current);
  if (!a.length || !b.length) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export interface UpdateCheck {
  current: string;
  /** The latest release's tag. */
  latest: string;
  newer: boolean;
  /** The release's page. */
  url: string;
}

/** Asks GitHub for the latest release and compares it with this build. Throws when GitHub cannot be reached or there is no release. */
export async function checkForUpdates(): Promise<UpdateCheck> {
  const current = await appVersion();
  const response = await fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } });
  if (response.status === 404) throw new Error("No release has been published yet");
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = (await response.json()) as { tag_name?: string; name?: string; html_url?: string };
  const latest = release.tag_name ?? release.name ?? "";
  const url = release.html_url?.startsWith(`${RELEASES_PAGE}/`) ? release.html_url : RELEASES_PAGE;
  return { current, latest, newer: isNewer(latest, current), url };
}
