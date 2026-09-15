import { render, screen, fireEvent } from "@testing-library/react";
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
