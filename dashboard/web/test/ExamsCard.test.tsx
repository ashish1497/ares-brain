import { render, screen } from "@testing-library/react";
import { ExamsCard } from "../src/components/ExamsCard";
import { exam } from "./factories";

test("shows the countdown and the readiness badges", () => {
  render(<ExamsCard exams={[exam({ inDays: 11, brainReady: true, testprepExists: false })]} />);
  expect(screen.getByText(/in 11d/)).toBeInTheDocument();
  expect(screen.getByText("brain ready")).toBeInTheDocument();
  expect(screen.getByText("no practice set")).toBeInTheDocument();
});

test("countdown collapses to today / tomorrow", () => {
  const { rerender } = render(<ExamsCard exams={[exam({ inDays: 0 })]} />);
  expect(screen.getByText(/today/)).toBeInTheDocument();
  rerender(<ExamsCard exams={[exam({ inDays: 1 })]} />);
  expect(screen.getByText(/tomorrow/)).toBeInTheDocument();
});

test("empty state", () => {
  render(<ExamsCard exams={[]} />);
  expect(screen.getByText("No exams on record")).toBeInTheDocument();
});
