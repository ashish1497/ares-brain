import { fireEvent, render, screen } from "@testing-library/react";
import { useHashRoute } from "../src/lib/useHashRoute";

function Probe() {
  const { tab, params, go } = useHashRoute();
  return (
    <div>
      <span data-testid="tab">{tab}</span>
      <span data-testid="params">{params.join(",")}</span>
      <button onClick={() => go("assignments/x/1")}>go</button>
    </div>
  );
}

afterEach(() => {
  window.location.hash = "";
});

test("empty hash defaults to today with no params", () => {
  render(<Probe />);
  expect(screen.getByTestId("tab")).toHaveTextContent("today");
  expect(screen.getByTestId("params")).toHaveTextContent("");
});

test("parses #assignments/slug/7 into tab and params", () => {
  window.location.hash = "#assignments/slug/7";
  render(<Probe />);
  expect(screen.getByTestId("tab")).toHaveTextContent("assignments");
  expect(screen.getByTestId("params")).toHaveTextContent("slug,7");
});

test("go() updates the hash and re-renders with the new route", async () => {
  render(<Probe />);
  fireEvent.click(screen.getByText("go"));
  expect(window.location.hash).toBe("#assignments/x/1");
  // jsdom dispatches "hashchange" asynchronously, so the re-render lands a tick later.
  expect(await screen.findByTestId("tab")).toHaveTextContent("assignments");
  expect(screen.getByTestId("params")).toHaveTextContent("x,1");
});
