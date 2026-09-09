import { render, screen } from "@testing-library/react";
import { MetaRow } from "../src/components/MetaRow";

test("puts a rule between items and none before the first", () => {
  render(<MetaRow items={["one", "two", "three"]} />);
  expect(screen.getByText("one")).toBeInTheDocument();
  expect(screen.getByText("two")).toBeInTheDocument();
  expect(screen.getByText("three")).toBeInTheDocument();
  // 3 items → 2 rules (none before the first item)
  expect(screen.getAllByRole("separator")).toHaveLength(2);
});

test("a single item renders no rule at all", () => {
  render(<MetaRow items={["solo"]} />);
  expect(screen.getByText("solo")).toBeInTheDocument();
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
});
