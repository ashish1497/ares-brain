import { useCallback, useSyncExternalStore } from "react";

function read(): string {
  return window.location.hash.replace(/^#/, "") || "today";
}

/** Parses `#tab/seg/seg` from the URL hash; `go()` navigates by setting the hash. */
export function useHashRoute(): { tab: string; params: string[]; go: (hash: string) => void } {
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    read,
    () => "today",
  );
  const [tab, ...params] = hash.split("/");
  const go = useCallback((h: string) => {
    window.location.hash = h;
  }, []);
  return { tab: tab || "today", params, go };
}
