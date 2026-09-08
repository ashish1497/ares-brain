import { render, screen } from "@testing-library/preact";
import { CoursePicker } from "../src/components/CoursePicker";

test("renders an option per course", () => {
  render(
    <CoursePicker
      courses={[
        { slug: "a", name: "Alpha" },
        { slug: "b", name: "Beta" },
      ]}
      value="a"
      onChange={() => {}}
    />,
  );
  expect(screen.getByRole("option", { name: "Alpha" })).toBeDefined();
  expect(screen.getByRole("option", { name: "Beta" })).toBeDefined();
});
