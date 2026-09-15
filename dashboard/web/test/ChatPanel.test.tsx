import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ChatPanel } from "../src/components/ChatPanel";
import * as api from "../src/api";

test("sending a message calls startJob with kind chat and the typed text", async () => {
  const spy = vi.spyOn(api, "startJob").mockResolvedValue({ jobId: "j1" });
  vi.spyOn(api, "streamLog").mockImplementation(() => () => {});
  render(<ChatPanel />);
  fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: "what's due?" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  expect(spy).toHaveBeenCalledWith({ kind: "chat", message: "what's due?" });
});

test("I12: a busy (409) startJob failure shows an error message instead of silently doing nothing", async () => {
  vi.spyOn(api, "startJob").mockResolvedValue({ error: "busy" });
  render(<ChatPanel />);
  fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: "what's due?" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(screen.getByText(/busy/i)).toBeInTheDocument());
  // the app didn't crash, and the user's typed message is still there to retry
  expect(screen.getByPlaceholderText(/ask/i)).toHaveValue("what's due?");
});
