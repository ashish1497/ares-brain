import { act, render, screen, fireEvent } from "@testing-library/react";
import { CopyButton } from "../src/components/CopyButton";

const stubClipboard = () => {
  const writeText = vi.fn();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
};

test("writes the value to the clipboard and shows the note", () => {
  const writeText = stubClipboard();

  render(<CopyButton value={'/mesa:ares-brain-testprep "X"'} label="Practice set" />);
  expect(screen.queryByText(/copied/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Practice set" }));

  expect(writeText).toHaveBeenCalledWith('/mesa:ares-brain-testprep "X"');
  expect(screen.getByText("copied — paste in Claude Code")).toBeInTheDocument();
});

test("the note clears after 2s", () => {
  vi.useFakeTimers();
  stubClipboard();
  try {
    render(<CopyButton value="x" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/copied/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText(/copied/)).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
