import "@testing-library/jest-dom";

// Node 22+'s experimental global `localStorage` (enabled without `--localstorage-file`)
// shadows jsdom's real Storage implementation and throws on every access. Replace it
// with a plain in-memory polyfill so tests can exercise real localStorage behaviour.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

// Only replace localStorage if the environment's own implementation is broken. jsdom
// normally provides a real `Storage` instance (so `vi.spyOn(Storage.prototype, ...)`
// works); Node 22+'s experimental global `localStorage` shadows it and throws on every
// access. Probe first — installing the polyfill unconditionally would silently disable
// all `Storage.prototype`-based mocking (see test/theme.test.ts's private-mode test).
try {
  globalThis.localStorage.setItem("__probe", "1");
  globalThis.localStorage.removeItem("__probe");
} catch {
  // NOTE: this polyfill's getItem/setItem/etc. are own properties, not inherited from
  // Storage.prototype, so `vi.spyOn(Storage.prototype, "getItem")` will NOT intercept
  // calls made through it — spy on the instance (`globalThis.localStorage`) instead.
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  });
}
