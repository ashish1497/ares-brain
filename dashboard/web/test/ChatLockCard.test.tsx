import { render, screen } from "@testing-library/react";
import { ChatLockCard } from "../src/components/ChatLockCard";
import { kpis } from "./factories";

test("locked: shows the count, a progress bar and a disabled input", () => {
  render(<ChatLockCard k={kpis({ brainReady: 6, courseCount: 17 })} unlockAt={15} />);
  expect(screen.getByText("6 of 17 brains ready — chat unlocks at 15")).toBeInTheDocument();
  const bar = screen.getByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "40");
  expect(screen.getByPlaceholderText(/Chat unlocks/)).toBeDisabled();
});

test("unlocked: says phase 2, no progress bar", () => {
  render(<ChatLockCard k={kpis({ brainReady: 15 })} unlockAt={15} />);
  expect(screen.getByText("ready — chat lands in phase 2")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
