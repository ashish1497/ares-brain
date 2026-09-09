import { render, screen, fireEvent } from "@testing-library/react";
import { AssignmentChecklist } from "../src/components/assignments/AssignmentChecklist";

beforeEach(() => {
  localStorage.clear();
});

test("the add-step input carries an accessible label", () => {
  render(<AssignmentChecklist id="a1" />);
  expect(screen.getByLabelText("Add a checklist step")).toBeInTheDocument();
});

test("adding an item persists to localStorage['ares.checklist.<id>']", () => {
  render(<AssignmentChecklist id="a1" />);
  fireEvent.change(screen.getByPlaceholderText("Add a step"), { target: { value: "Read spec" } });
  fireEvent.keyDown(screen.getByPlaceholderText("Add a step"), { key: "Enter" });
  expect(screen.getByText("Read spec")).toBeInTheDocument();
  const stored = JSON.parse(localStorage.getItem("ares.checklist.a1") ?? "[]");
  expect(stored).toEqual([{ text: "Read spec", done: false }]);
});

test("a fresh mount reads the persisted checklist back", () => {
  localStorage.setItem(
    "ares.checklist.a1",
    JSON.stringify([{ text: "Draft outline", done: false }]),
  );
  render(<AssignmentChecklist id="a1" />);
  expect(screen.getByText("Draft outline")).toBeInTheDocument();
});

test("toggling a checkbox writes done: true", () => {
  localStorage.setItem("ares.checklist.a1", JSON.stringify([{ text: "Step", done: false }]));
  render(<AssignmentChecklist id="a1" />);
  fireEvent.click(screen.getByRole("checkbox"));
  const stored = JSON.parse(localStorage.getItem("ares.checklist.a1") ?? "[]");
  expect(stored).toEqual([{ text: "Step", done: true }]);
});

test("deleting an item removes it", () => {
  localStorage.setItem("ares.checklist.a1", JSON.stringify([{ text: "Gone soon", done: false }]));
  render(<AssignmentChecklist id="a1" />);
  fireEvent.click(screen.getByRole("button", { name: "delete" }));
  expect(screen.queryByText("Gone soon")).not.toBeInTheDocument();
  const stored = JSON.parse(localStorage.getItem("ares.checklist.a1") ?? "[]");
  expect(stored).toEqual([]);
});

test("the status segmented control persists to ares.localstatus.<id>", () => {
  render(<AssignmentChecklist id="a1" />);
  fireEvent.click(screen.getByRole("button", { name: "started" }));
  expect(localStorage.getItem("ares.localstatus.a1")).toBe("started");
});

test("a JSON string under the checklist key does not crash and renders no items", () => {
  localStorage.setItem("ares.checklist.a1", JSON.stringify("hello"));
  expect(() => render(<AssignmentChecklist id="a1" />)).not.toThrow();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("a JSON object under the checklist key does not crash, and add() still works afterward", () => {
  localStorage.setItem("ares.checklist.a1", JSON.stringify({ a: 1 }));
  render(<AssignmentChecklist id="a1" />);
  expect(() => {
    fireEvent.change(screen.getByPlaceholderText("Add a step"), {
      target: { value: "New step" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Add a step"), { key: "Enter" });
  }).not.toThrow();
  expect(screen.getByText("New step")).toBeInTheDocument();
});

test("literal 'null' under the checklist key renders no items and does not crash", () => {
  localStorage.setItem("ares.checklist.a1", "null");
  expect(() => render(<AssignmentChecklist id="a1" />)).not.toThrow();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("an array with a malformed item (wrong field types) filters that item out", () => {
  localStorage.setItem(
    "ares.checklist.a1",
    JSON.stringify([{ text: 1 }, { text: "Good", done: true }]),
  );
  render(<AssignmentChecklist id="a1" />);
  expect(screen.getByText("Good")).toBeInTheDocument();
  expect(screen.getAllByRole("checkbox").length).toBe(1);
});

test("an unrecognised status value falls back to the first status, not an unselected control", () => {
  localStorage.setItem("ares.localstatus.a1", "bogus-status");
  render(<AssignmentChecklist id="a1" />);
  const notStarted = screen.getByRole("button", { name: "not started" });
  expect(notStarted.className).toContain("bg-card");
});

test("checkbox carries the shared focus-visible ring treatment and accent color", () => {
  localStorage.setItem("ares.checklist.a1", JSON.stringify([{ text: "Step", done: false }]));
  render(<AssignmentChecklist id="a1" />);
  const checkbox = screen.getByRole("checkbox");
  expect(checkbox.className).toContain("focus-visible:ring-2");
  expect(checkbox.className).toContain("focus-visible:ring-edge");
  expect(checkbox.className).toContain("accent-[color:var(--color-edge)]");
});

test("aria-pressed reflects the selected status button and follows a click", () => {
  render(<AssignmentChecklist id="a1" />);
  const notStarted = screen.getByRole("button", { name: "not started" });
  const started = screen.getByRole("button", { name: "started" });
  const submitted = screen.getByRole("button", { name: "submitted" });

  expect(notStarted).toHaveAttribute("aria-pressed", "true");
  expect(started).toHaveAttribute("aria-pressed", "false");
  expect(submitted).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(started);

  expect(notStarted).toHaveAttribute("aria-pressed", "false");
  expect(started).toHaveAttribute("aria-pressed", "true");
  expect(submitted).toHaveAttribute("aria-pressed", "false");
});

test("a storage that throws does not crash the component", () => {
  const getSpy = vi.spyOn(globalThis.localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const setSpy = vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  try {
    expect(() => render(<AssignmentChecklist id="a1" />)).not.toThrow();
    fireEvent.change(screen.getByPlaceholderText("Add a step"), {
      target: { value: "Still works" },
    });
    expect(() =>
      fireEvent.keyDown(screen.getByPlaceholderText("Add a step"), { key: "Enter" }),
    ).not.toThrow();
    expect(screen.getByText("Still works")).toBeInTheDocument();
    expect(screen.getByText(/not saved — storage unavailable/)).toBeInTheDocument();
  } finally {
    getSpy.mockRestore();
    setSpy.mockRestore();
  }
});
