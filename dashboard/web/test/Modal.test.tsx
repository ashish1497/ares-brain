import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "../src/components/Modal";

test("closed renders nothing", () => {
  const { container } = render(
    <Modal open={false} onClose={vi.fn()} title="Title">
      <p>body</p>
    </Modal>,
  );
  expect(container).toBeEmptyDOMElement();
});

test("open renders a labelled dialog", () => {
  render(
    <Modal open onClose={vi.fn()} title="A Course">
      <p>body</p>
    </Modal>,
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  const labelledBy = dialog.getAttribute("aria-labelledby");
  expect(labelledBy).toBeTruthy();
  expect(document.getElementById(labelledBy!)).toHaveTextContent("A Course");
});

test("focus lands inside the dialog on open", () => {
  render(
    <Modal open onClose={vi.fn()} title="A Course">
      <button type="button">Do thing</button>
    </Modal>,
  );
  expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
});

test("Escape calls onClose", () => {
  const onClose = vi.fn();
  render(
    <Modal open onClose={onClose} title="A Course">
      <p>body</p>
    </Modal>,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("clicking the backdrop calls onClose", () => {
  const onClose = vi.fn();
  render(
    <Modal open onClose={onClose} title="A Course">
      <p>body</p>
    </Modal>,
  );
  fireEvent.click(screen.getByRole("dialog").parentElement!);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("clicking inside the panel does not call onClose", () => {
  const onClose = vi.fn();
  render(
    <Modal open onClose={onClose} title="A Course">
      <p>body content</p>
    </Modal>,
  );
  fireEvent.click(screen.getByText("body content"));
  expect(onClose).not.toHaveBeenCalled();
});
