import { applyTheme, getThemePrefs, setThemePrefs } from "../src/lib/theme";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.appearance;
});

test("applyTheme writes documentElement dataset from defaults when nothing stored", () => {
  applyTheme();
  expect(document.documentElement.dataset.theme).toBe("meadow");
  expect(document.documentElement.dataset.appearance).toBe("system");
});

test("setThemePrefs persists and applies the given prefs", () => {
  setThemePrefs({ theme: "violet", appearance: "dark" });
  expect(localStorage.getItem("ares.theme")).toBe("violet");
  expect(localStorage.getItem("ares.appearance")).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("violet");
  expect(document.documentElement.dataset.appearance).toBe("dark");
});

test("getThemePrefs reads stored values", () => {
  localStorage.setItem("ares.theme", "violet");
  localStorage.setItem("ares.appearance", "light");
  expect(getThemePrefs()).toEqual({ theme: "violet", appearance: "light" });
});

test("getThemePrefs falls back to defaults when localStorage holds junk", () => {
  localStorage.setItem("ares.theme", "nonsense");
  localStorage.setItem("ares.appearance", "nonsense");
  expect(getThemePrefs()).toEqual({ theme: "meadow", appearance: "system" });
});

test("getThemePrefs falls back to defaults when localStorage throws (private mode)", () => {
  // Spy on the instance, not Storage.prototype: test/setup.ts installs a plain-object
  // polyfill on some Node versions whose getItem is an own property, not inherited from
  // Storage.prototype — spying the prototype there would silently never be called.
  const spy = vi.spyOn(globalThis.localStorage, "getItem").mockImplementation(() => {
    throw new Error("private mode");
  });
  try {
    expect(getThemePrefs()).toEqual({ theme: "meadow", appearance: "system" });
  } finally {
    spy.mockRestore();
  }
});
