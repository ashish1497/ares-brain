import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "../src/components/Header";
import { overview, kpis } from "./factories";

test("renders the four stat chips", () => {
  render(
    <Header
      ov={overview({ kpis: kpis({ dueThisWeek: 2, nextExamInDays: 6, brainReady: 2 }) })}
      busy={false}
      onResync={vi.fn()}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  expect(screen.getByText("2")).toBeInTheDocument();
  expect(screen.getByText("due")).toBeInTheDocument();
  expect(screen.getByText("6d")).toBeInTheDocument();
  expect(screen.getByText("exam")).toBeInTheDocument();
  expect(screen.getByText("att")).toBeInTheDocument();
  expect(screen.getByText("brain")).toBeInTheDocument();
});

test("the exam chip is soon-tinted when nextExamInDays is within a week", () => {
  render(
    <Header
      ov={overview({ kpis: kpis({ nextExamInDays: 6 }) })}
      busy={false}
      onResync={vi.fn()}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  expect(screen.getByText("6d").closest("div")).toHaveClass("bg-soon");
});

test("the exam chip is not tinted when nextExamInDays is null", () => {
  render(
    <Header
      ov={overview({ kpis: kpis({ nextExamInDays: null }) })}
      busy={false}
      onResync={vi.fn()}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  expect(screen.getByText("—").closest("div")).not.toHaveClass("bg-soon");
});

test("a tinted chip's label does not carry the ink-muted color class (would be invisible on the fill)", () => {
  render(
    <Header
      ov={overview({ kpis: kpis({ nextExamInDays: 6 }) })}
      busy={false}
      onResync={vi.fn()}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  const label = screen.getByText("exam");
  expect(label.className).not.toMatch(/ink-muted/);
});

test("an untinted chip's label still carries the ink-muted color class", () => {
  render(
    <Header
      ov={overview({ kpis: kpis({ nextExamInDays: null }) })}
      busy={false}
      onResync={vi.fn()}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  const label = screen.getByText("exam");
  expect(label.className).toMatch(/ink-muted/);
});

test("Re-sync is disabled and reads syncing… when busy", () => {
  render(
    <Header ov={overview()} busy onResync={vi.fn()} onRefresh={vi.fn()} onOpenSettings={vi.fn()} />,
  );
  const btn = screen.getByRole("button", { name: "syncing…" });
  expect(btn).toBeDisabled();
});

test("clicking Re-sync calls onResync", () => {
  const onResync = vi.fn();
  render(
    <Header
      ov={overview()}
      busy={false}
      onResync={onResync}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "⟲ Re-sync" }));
  expect(onResync).toHaveBeenCalledTimes(1);
});

test("the 'r' key calls onResync when no input is focused and not busy", () => {
  const onResync = vi.fn();
  render(
    <Header
      ov={overview()}
      busy={false}
      onResync={onResync}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  fireEvent.keyDown(document, { key: "r" });
  expect(onResync).toHaveBeenCalledTimes(1);
});

test("the 'r' key does nothing when busy", () => {
  const onResync = vi.fn();
  render(
    <Header
      ov={overview()}
      busy
      onResync={onResync}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  fireEvent.keyDown(document, { key: "r" });
  expect(onResync).not.toHaveBeenCalled();
});

test("the 'r' key does nothing when a modifier is held (Cmd/Ctrl+R reload shortcut)", () => {
  const onResync = vi.fn();
  render(
    <Header
      ov={overview()}
      busy={false}
      onResync={onResync}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  fireEvent.keyDown(document, { key: "r", metaKey: true });
  fireEvent.keyDown(document, { key: "r", ctrlKey: true });
  fireEvent.keyDown(document, { key: "r", altKey: true });
  expect(onResync).not.toHaveBeenCalled();
});

test("the 'r' key does nothing when an input is focused", () => {
  const onResync = vi.fn();
  render(
    <div>
      <input aria-label="search" />
      <Header
        ov={overview()}
        busy={false}
        onResync={onResync}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    </div>,
  );
  screen.getByLabelText("search").focus();
  fireEvent.keyDown(document, { key: "r" });
  expect(onResync).not.toHaveBeenCalled();
});

test("the sticky bar is full-bleed while its content is capped at 1400px", () => {
  render(
    <Header
      ov={overview()}
      busy={false}
      onResync={vi.fn()}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  const header = screen.getByText("ARES BRAIN").closest("header")!;
  expect(header).not.toHaveClass("max-w-[1400px]");
  const inner = header.querySelector(":scope > div")!;
  expect(inner).toHaveClass("mx-auto");
  expect(inner).toHaveClass("max-w-[1400px]");
});

test("renders the digest freshness text and a refresh button that calls onRefresh", () => {
  const onRefresh = vi.fn();
  render(
    <Header
      ov={overview()}
      busy={false}
      onResync={vi.fn()}
      onRefresh={onRefresh}
      onOpenSettings={vi.fn()}
    />,
  );
  expect(screen.getByText(/^digest ·/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh digest" }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test("the refresh button is distinct from Re-sync", () => {
  render(
    <Header
      ov={overview()}
      busy={false}
      onResync={vi.fn()}
      onRefresh={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Refresh digest" })).not.toBe(
    screen.getByRole("button", { name: "⟲ Re-sync" }),
  );
});

test("clicking the gear opens Settings", () => {
  const onOpenSettings = vi.fn();
  render(
    <Header
      ov={overview()}
      busy={false}
      onResync={vi.fn()}
      onRefresh={vi.fn()}
      onOpenSettings={onOpenSettings}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
});
