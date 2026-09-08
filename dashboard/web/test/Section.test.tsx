import { render, screen } from "@testing-library/react";
import { Section } from "../src/components/Section";

test("renders an uppercase-able heading, the right slot and children", () => {
  render(
    <Section title="Exam prep" right={<span>note</span>}>
      <p>body</p>
    </Section>,
  );
  const h = screen.getByRole("heading", { name: "Exam prep" });
  expect(h.className).toContain("uppercase");
  expect(screen.getByText("note")).toBeInTheDocument();
  expect(screen.getByText("body")).toBeInTheDocument();
});
