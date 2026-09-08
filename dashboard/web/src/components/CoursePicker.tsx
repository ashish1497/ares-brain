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
