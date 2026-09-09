import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../src/components/ErrorBoundary";

function Boom(): never {
  throw new Error("kaboom");
}

test("a child that throws renders the fallback panel instead of propagating", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("something went wrong")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  } finally {
    spy.mockRestore();
  }
});

test("renders children normally when nothing throws", () => {
  render(
    <ErrorBoundary>
      <p>all good</p>
    </ErrorBoundary>,
  );
  expect(screen.getByText("all good")).toBeInTheDocument();
});
