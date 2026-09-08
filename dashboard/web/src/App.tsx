import { useEffect, useState } from "react";
import { getOverview, type Overview } from "./api";

export function App() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    getOverview()
      .then(setOv)
      .catch((e) => setErr(String(e)));
  }, []);
  if (err) return <pre className="p-6 text-[var(--color-bad)]">{err}</pre>;
  if (!ov) return <div className="p-6">loading…</div>;
  return <pre className="p-6 text-xs">{JSON.stringify(ov, null, 2)}</pre>;
}
