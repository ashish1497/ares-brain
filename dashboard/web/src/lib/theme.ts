export type ThemeName = "meadow" | "violet";
export type Appearance = "system" | "light" | "dark";

const TKEY = "ares.theme";
const AKEY = "ares.appearance";

/** Reads theme + appearance from localStorage, falling back to defaults on junk or a throw (private mode). */
export function getThemePrefs(): { theme: ThemeName; appearance: Appearance } {
  let theme: ThemeName = "meadow";
  let appearance: Appearance = "system";
  try {
    const t = localStorage.getItem(TKEY);
    if (t === "meadow" || t === "violet") theme = t;
    const a = localStorage.getItem(AKEY);
    if (a === "system" || a === "light" || a === "dark") appearance = a;
  } catch {
    /* private mode */
  }
  return { theme, appearance };
}

/** Persists theme + appearance to localStorage (best-effort) and re-applies them. */
export function setThemePrefs(p: { theme: ThemeName; appearance: Appearance }): void {
  try {
    localStorage.setItem(TKEY, p.theme);
    localStorage.setItem(AKEY, p.appearance);
  } catch {
    /* private mode */
  }
  applyTheme();
}

/** Writes the current theme prefs onto `<html data-theme data-appearance>`. */
export function applyTheme(): void {
  const { theme, appearance } = getThemePrefs();
  const r = document.documentElement;
  r.dataset.theme = theme;
  r.dataset.appearance = appearance;
}
