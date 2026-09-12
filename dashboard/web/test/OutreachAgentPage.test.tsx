import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../src/api";
import { OutreachAgentPage } from "../src/components/outreach/OutreachAgentPage";
import type { OutreachState } from "../src/api";

vi.mock("../src/api", async (orig) => ({
  ...(await orig<typeof import("../src/api")>()),
  startOutreachSession: vi.fn(),
  runOutreachSection: vi.fn(),
  setOutreachTarget: vi.fn(),
}));

function emptyState(over: Partial<OutreachState> = {}): OutreachState {
  return {
    myCompany: "Acme",
    whatIDo: "widgets",
    targetAccount: null,
    sections: { icp: null, industry: null, company: null, people: null, outreach: null },
    edited: { icp: false, industry: false, company: false, people: false, outreach: false },
    verification: {},
    doNotUse: [],
    ...over,
  };
}

test("submitting the intake form creates a session and kicks off the ICP step", async () => {
  vi.mocked(api.startOutreachSession).mockResolvedValue({
    sessionId: "s1",
    state: emptyState(),
  });
  vi.mocked(api.runOutreachSection).mockResolvedValue({
    section: "icp",
    content: { icp_summary: "a great ICP", candidates: [] },
    state: emptyState({
      sections: {
        icp: { icp_summary: "a great ICP", candidates: [] },
        industry: null,
        company: null,
        people: null,
        outreach: null,
      },
    }),
  });

  render(<OutreachAgentPage go={() => {}} />);

  fireEvent.change(screen.getByLabelText("What company are you from?"), {
    target: { value: "Acme" },
  });
  fireEvent.change(screen.getByLabelText("What do you do?"), { target: { value: "widgets" } });
  fireEvent.click(screen.getByText("Find my ICP"));

  await waitFor(() => expect(api.startOutreachSession).toHaveBeenCalledWith("Acme", "widgets"));
  await waitFor(() => expect(screen.getByText("a great ICP")).toBeInTheDocument());
  expect(api.runOutreachSection).toHaveBeenCalledWith("s1", "icp");
});

test("picking a target account sets it and runs the downstream chain in order", async () => {
  vi.mocked(api.setOutreachTarget).mockResolvedValue({
    state: emptyState({ targetAccount: "Onsurity" }),
  });
  const order: string[] = [];
  vi.mocked(api.runOutreachSection).mockImplementation(async (_sid, section) => {
    order.push(section);
    return {
      section,
      content: {},
      state: emptyState({ targetAccount: "Onsurity" }),
    };
  });

  render(<OutreachAgentPage go={() => {}} />);
  // Skip the intake form by starting from a session that already has an ICP result.
  vi.mocked(api.startOutreachSession).mockResolvedValue({
    sessionId: "s1",
    state: emptyState({
      sections: {
        icp: { icp_summary: "x", candidates: [{ name: "Onsurity", why_fit: "fits" }] },
        industry: null,
        company: null,
        people: null,
        outreach: null,
      },
    }),
  });
  order.length = 0;
  vi.mocked(api.runOutreachSection).mockImplementation(async (_sid, section) => {
    if (section === "icp") {
      return {
        section,
        content: { icp_summary: "x", candidates: [{ name: "Onsurity", why_fit: "fits" }] },
        state: emptyState({
          sections: {
            icp: { icp_summary: "x", candidates: [{ name: "Onsurity", why_fit: "fits" }] },
            industry: null,
            company: null,
            people: null,
            outreach: null,
          },
        }),
      };
    }
    order.push(section);
    return { section, content: {}, state: emptyState({ targetAccount: "Onsurity" }) };
  });

  fireEvent.change(screen.getByLabelText("What company are you from?"), {
    target: { value: "Acme" },
  });
  fireEvent.change(screen.getByLabelText("What do you do?"), { target: { value: "widgets" } });
  fireEvent.click(screen.getByText("Find my ICP"));

  await waitFor(() => expect(screen.getByText("Onsurity")).toBeInTheDocument());
  fireEvent.click(screen.getByText("Onsurity"));

  await waitFor(() => expect(order).toEqual(["industry", "company", "people", "outreach"]));
  expect(api.setOutreachTarget).toHaveBeenCalledWith("s1", "Onsurity");
});
