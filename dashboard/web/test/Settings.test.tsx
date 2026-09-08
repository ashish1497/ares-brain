import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../src/components/Settings";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.appearance;
});

test("clicking the violet swatch writes localStorage and sets the theme dataset", () => {
  render(<Settings open onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Ultraviolet/ }));
  expect(localStorage.getItem("ares.theme")).toBe("violet");
  expect(document.documentElement.dataset.theme).toBe("violet");
});

test("the Dark segment writes appearance and sets the appearance dataset", () => {
  render(<Settings open onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Dark" }));
  expect(localStorage.getItem("ares.appearance")).toBe("dark");
  expect(document.documentElement.dataset.appearance).toBe("dark");
});

test("a re-mount reflects the stored values", () => {
  localStorage.setItem("ares.theme", "violet");
  localStorage.setItem("ares.appearance", "dark");
  render(<Settings open onClose={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Ultraviolet/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
});

test("Escape calls onClose", () => {
  const onClose = vi.fn();
  render(<Settings open onClose={onClose} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("clicking the backdrop calls onClose", () => {
  const onClose = vi.fn();
  render(<Settings open onClose={onClose} />);
  fireEvent.click(screen.getByRole("dialog").parentElement!);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("renders nothing when closed", () => {
  render(<Settings open={false} onClose={vi.fn()} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
