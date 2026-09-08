import { act, render, screen, fireEvent } from "@testing-library/react";
import { CopyButton } from "../src/components/CopyButton";

const stubClipboard = (writeText = vi.fn().mockResolvedValue(undefined)) => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
};

test("writes the value to the clipboard and shows the note", async () => {
  const writeText = stubClipboard();

  render(<CopyButton value={'/mesa:ares-brain-testprep "X"'} label="Practice set" />);
  expect(screen.queryByText(/copied/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Practice set" }));

  expect(writeText).toHaveBeenCalledWith('/mesa:ares-brain-testprep "X"');
  expect(await screen.findByText("copied — paste in Claude Code")).toBeInTheDocument();
});

test("the note clears after 2s", async () => {
  vi.useFakeTimers();
  stubClipboard();
  try {
    render(<CopyButton value="x" />);
    fireEvent.click(screen.getByRole("button"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/copied/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/copied/)).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("a rejected writeText swallows the error and shows no note", async () => {
  stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));

  render(<CopyButton value="x" />);
  fireEvent.click(screen.getByRole("button"));

  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByText(/copied/)).not.toBeInTheDocument();
});

test("no clipboard API: click does not throw and shows no note", () => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

  render(<CopyButton value="x" />);
  expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
  expect(screen.queryByText(/copied/)).not.toBeInTheDocument();
});
