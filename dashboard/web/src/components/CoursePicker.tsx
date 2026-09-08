import type { Course } from "../api";

export function CoursePicker({
  courses,
  value,
  onChange,
}: {
  courses: Course[];
  value: string;
  onChange: (slug: string) => void;
}) {
  if (!courses.length)
    return (
      <span class="text-[13px] text-[var(--color-ink-soft)]">No courses yet — run Sync first.</span>
    );
  return (
    <select
      class="h-9 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm"
      value={value}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
    >
      {courses.map((c) => (
        <option value={c.slug}>{c.name}</option>
      ))}
    </select>
  );
}
