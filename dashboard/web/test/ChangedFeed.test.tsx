import { render, screen } from "@testing-library/react";
import { ChangedFeed, pluralizeCount } from "../src/components/today/ChangedFeed";
import { changed } from "./factories";

test("a row shows the course name, not the slug", () => {
  render(
    <ChangedFeed
      changed={[changed({ courseName: "Selling & Negotiating", courseSlug: "sell-neg" })]}
      scrapeAgeHours={2}
    />,
  );
  expect(screen.getByText("Selling & Negotiating")).toBeInTheDocument();
  expect(screen.queryByText("sell-neg")).not.toBeInTheDocument();
});

test("counts render as chips, not text", () => {
  render(
    <ChangedFeed
      changed={[changed({ counts: { announcement: 4, material: 1 } })]}
      scrapeAgeHours={2}
    />,
  );
  const chip = screen.getByText("4 announcements");
  expect(chip.tagName).toBe("SPAN");
  expect(chip).toHaveClass("bg-card");
  expect(screen.getByText("1 material")).toBeInTheDocument();
  expect(screen.queryByText("·")).not.toBeInTheDocument();
});

test("pluralizeCount handles singular vs plural", () => {
  expect(pluralizeCount("announcement", 1)).toBe("1 announcement");
  expect(pluralizeCount("announcement", 4)).toBe("4 announcements");
});

test("empty changed list renders nothing (parent handles the all-empty case)", () => {
  const { container } = render(<ChangedFeed changed={[]} scrapeAgeHours={2} />);
  expect(container).toBeEmptyDOMElement();
});

test("the panel gets the card treatment (border, shadow, bg-card)", () => {
  const { container } = render(<ChangedFeed changed={[changed()]} scrapeAgeHours={2} />);
  expect(container.firstChild).toHaveClass(
    "rounded-nb",
    "border-[3px]",
    "border-edge",
    "bg-card",
    "shadow-[var(--nb-shadow)]",
  );
});
