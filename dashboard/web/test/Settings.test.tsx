import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../src/components/Settings";
import { overview } from "./factories";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.appearance;
});

test("clicking the violet swatch writes localStorage and sets the theme dataset", () => {
  render(<Settings open onClose={vi.fn()} ov={overview()} onJob={vi.fn()} busy={false} />);
  fireEvent.click(screen.getByRole("button", { name: /Ultraviolet/ }));
  expect(localStorage.getItem("ares.theme")).toBe("violet");
  expect(document.documentElement.dataset.theme).toBe("violet");
});

test("the Dark segment writes appearance and sets the appearance dataset", () => {
  render(<Settings open onClose={vi.fn()} ov={overview()} onJob={vi.fn()} busy={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Dark" }));
  expect(localStorage.getItem("ares.appearance")).toBe("dark");
  expect(document.documentElement.dataset.appearance).toBe("dark");
});

test("a re-mount reflects the stored values", () => {
  localStorage.setItem("ares.theme", "violet");
  localStorage.setItem("ares.appearance", "dark");
  render(<Settings open onClose={vi.fn()} ov={overview()} onJob={vi.fn()} busy={false} />);
  expect(screen.getByRole("button", { name: /Ultraviolet/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
});

test("Escape calls onClose", () => {
  const onClose = vi.fn();
  render(<Settings open onClose={onClose} ov={overview()} onJob={vi.fn()} busy={false} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("clicking the backdrop calls onClose", () => {
  const onClose = vi.fn();
  render(<Settings open onClose={onClose} ov={overview()} onJob={vi.fn()} busy={false} />);
  fireEvent.click(screen.getByRole("dialog").parentElement!);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("renders nothing when closed", () => {
  render(<Settings open={false} onClose={vi.fn()} ov={overview()} onJob={vi.fn()} busy={false} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a non-default attendanceMin and chatUnlockAt render in the panel, not the hardcoded defaults", () => {
  render(
    <Settings
      open
      onClose={vi.fn()}
      ov={overview({ attendanceMin: 90, chatUnlockAt: 12 })}
      onJob={vi.fn()}
      busy={false}
    />,
  );
  expect(screen.getByText(/attendance minimum 90%/)).toBeInTheDocument();
  expect(screen.getByText(/chat unlock 12/)).toBeInTheDocument();
});

test("clicking Sync calendar calls onJob with calendar-sync", () => {
  const onJob = vi.fn();
  render(<Settings open onClose={vi.fn()} ov={overview()} onJob={onJob} busy={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Sync calendar" }));
  expect(onJob).toHaveBeenCalledWith("calendar-sync");
});

test("Sync calendar is disabled while busy", () => {
  render(<Settings open onClose={vi.fn()} ov={overview()} onJob={vi.fn()} busy />);
  expect(screen.getByRole("button", { name: "Sync calendar" })).toBeDisabled();
});

test("Settings has no bg-cta element — Re-sync stays the only primary action", () => {
  const { container } = render(
    <Settings open onClose={vi.fn()} ov={overview()} onJob={vi.fn()} busy={false} />,
  );
  expect(container.querySelector(".bg-cta")).toBeNull();
});
