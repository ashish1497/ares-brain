import { useEffect, useState } from "react";
import * as api from "../api";
import type { Course, DriveBrowse, DriveFolders, NoteHit, StudyItem } from "../api";
import { pickDriveFolder, DrivePickerError } from "../lib/drivePicker";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { SectionHeader } from "./SectionHeader";
import { StatePill } from "./StatePill";

/** Accepts either a bare Drive folder ID or a full Drive folder URL
 * (https://drive.google.com/drive/folders/<id>...) and returns the ID. */
export function extractFolderId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/\/folders\/([\w-]+)/);
  return m ? m[1] : trimmed;
}

/** Where a student sees what's shared for a course, connects a course to its
 * cohort Drive folder (I4 close-out — before this there was no UI for any
 * of it, only CLI subcommands), and shares a local note or testprep set.
 *
 * Two ways to connect: the Google Picker widget (nice UX, but its own
 * "Sign in" prompt appears regardless of the server-minted OAuth token
 * handed to it, since that token comes from a Desktop-type OAuth client,
 * not one registered with this page's origin — confirmed live, not a
 * guess) and pasting the folder ID/URL directly (works today, no extra
 * GCP setup). Both call the same register-folder endpoint. */
export function DriveTab() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState("");
  const [folders, setFolders] = useState<DriveFolders>({});
  const [browse, setBrowse] = useState<DriveBrowse | null>(null);
  const [notes, setNotes] = useState<NoteHit[]>([]);
  const [study, setStudy] = useState<StudyItem[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [manualId, setManualId] = useState("");
  const [sharing, setSharing] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<Record<string, string>>({});

  useEffect(() => {
    api.getCourses().then((cs) => {
      setCourses(cs);
      if (cs[0]) setSelected(cs[0].slug);
    });
    api.getDriveFolders().then(setFolders);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setBrowse(null);
    if (folders[selected]) {
      api.browseDrive(selected).then(setBrowse, (e: unknown) =>
        setBrowse({
          connected: true,
          error: e instanceof Error ? e.message : String(e),
          materials: [],
          transcripts: [],
          guide: null,
          notes: [],
          testprep: [],
        }),
      );
    }
    api.getNotes(selected).then((r) => setNotes(r.results));
    api.getStudy(selected).then((r) => setStudy(r.items));
  }, [selected, folders]);

  const connected = !!folders[selected];

  const connect = async () => {
    setConnecting(true);
    setConnectError("");
    try {
      const folderId = await pickDriveFolder();
      if (!folderId) return; // user cancelled
      const { folders: updated } = await api.registerDriveFolder(selected, folderId);
      setFolders(updated);
    } catch (e) {
      setConnectError(e instanceof DrivePickerError || e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const connectManual = async () => {
    const folderId = extractFolderId(manualId);
    if (!folderId) return;
    setConnecting(true);
    setConnectError("");
    try {
      const { folders: updated } = await api.registerDriveFolder(selected, folderId);
      setFolders(updated);
      setManualId("");
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const doShareNote = async (path: string) => {
    setSharing(path);
    try {
      const r = await api.shareNote(selected, path);
      setShareResult((p) => ({ ...p, [path]: r.ok ? (r.link ?? "shared") : `failed: ${r.error}` }));
    } finally {
      setSharing(null);
    }
  };

  const doShareStudy = async (name: string) => {
    setSharing(name);
    try {
      const r = await api.shareStudy(selected, name);
      setShareResult((p) => ({ ...p, [name]: r.ok ? (r.link ?? "shared") : `failed: ${r.error}` }));
    } finally {
      setSharing(null);
    }
  };

  if (courses.length === 0) {
    return (
      <Card className="md:p-6">
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          No courses yet — sync first.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="md:p-6">
        <SectionHeader
          rule={false}
          info="One Drive folder per course, shared with your cohort. Materials, transcripts, and the course guide sync automatically; notes and testprep sets are opt-in."
        >
          Drive
        </SectionHeader>
        <select
          className="mb-4 w-full rounded-nb border-[3px] border-edge bg-card px-3 py-2"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {courses.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>

        {connected ? (
          <div className="flex items-center gap-2">
            <StatePill state="ok">Connected</StatePill>
            <code className="text-[12px] text-[color:var(--color-ink-muted)]">
              {folders[selected]}
            </code>
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={connect} disabled={connecting}>
                {connecting ? "Working…" : "Connect via Picker"}
              </Button>
              <span className="text-[12px] text-[color:var(--color-ink-muted)]">or</span>
              <input
                className="min-w-[220px] flex-1 rounded-nb border-[3px] border-edge bg-card px-2 py-1 text-[13px]"
                placeholder="paste Drive folder ID or URL"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
              />
              <Button
                type="button"
                variant="neutral"
                onClick={connectManual}
                disabled={connecting || !manualId.trim()}
              >
                Connect
              </Button>
            </div>
            <p className="mt-2 text-[13px] text-[color:var(--color-ink-muted)]">
              Someone needs to have created and shared the cohort folder with you first — this just
              registers it locally. Commit config/course-drive-folders.json afterward to share the
              registration with your cohort. The Picker button needs its own Google sign-in (a
              Desktop-app limitation, not a bug) — pasting the ID/URL is the reliable path today.
            </p>
            {connectError && (
              <p className="mt-2 text-[13px] text-[color:var(--color-bad)]">{connectError}</p>
            )}
          </div>
        )}
      </Card>

      {connected && (
        <Card className="md:p-6">
          <SectionHeader rule={false}>What's shared</SectionHeader>
          {!browse ? (
            <p className="text-[13px] text-[color:var(--color-ink-muted)]">Loading…</p>
          ) : browse.error ? (
            <p className="text-[13px] text-[color:var(--color-bad)]">{browse.error}</p>
          ) : (
            <ul className="space-y-1 text-[13px]">
              <li>Materials: {browse.materials.length}</li>
              <li>Transcripts: {browse.transcripts.length}</li>
              <li>
                Guide:{" "}
                {browse.guide ? (
                  <a
                    href={browse.guide.link ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    shared
                  </a>
                ) : (
                  "not yet shared"
                )}
              </li>
              <li>
                Notes: {browse.notes.length}
                {browse.notes.length > 0 && (
                  <ul className="ml-4 mt-1 space-y-0.5">
                    {browse.notes.map((n, i) => (
                      <li key={i} className="text-[color:var(--color-ink-muted)]">
                        {n.name} — by {n.subfolder}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
              <li>
                Testprep: {browse.testprep.length}
                {browse.testprep.length > 0 && (
                  <ul className="ml-4 mt-1 space-y-0.5">
                    {browse.testprep.map((n, i) => (
                      <li key={i} className="text-[color:var(--color-ink-muted)]">
                        {n.name} — by {n.subfolder}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            </ul>
          )}
        </Card>
      )}

      <Card className="md:p-6">
        <SectionHeader
          rule={false}
          info="Sharing is always opt-in — nothing here is shared automatically."
        >
          Your notes
        </SectionHeader>
        {notes.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">No self-notes yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-rule)]">
            {notes.map((n) => (
              <li key={n.path} className="flex items-center justify-between gap-3 py-2">
                <span className="text-[13px]">{n.title}</span>
                <div className="flex items-center gap-2">
                  {shareResult[n.path] && (
                    <span className="text-[12px] text-[color:var(--color-ink-muted)]">
                      {shareResult[n.path]}
                    </span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="neutral"
                    disabled={!connected || sharing === n.path}
                    onClick={() => doShareNote(n.path)}
                  >
                    {sharing === n.path ? "Sharing…" : "Share"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="md:p-6">
        <SectionHeader rule={false}>Your testprep sets</SectionHeader>
        {study.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">No testprep sets yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-rule)]">
            {study.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-3 py-2">
                <span className="text-[13px]">{s.name}</span>
                <div className="flex items-center gap-2">
                  {shareResult[s.name] && (
                    <span className="text-[12px] text-[color:var(--color-ink-muted)]">
                      {shareResult[s.name]}
                    </span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="neutral"
                    disabled={!connected || sharing === s.name}
                    onClick={() => doShareStudy(s.name)}
                  >
                    {sharing === s.name ? "Sharing…" : "Share"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
