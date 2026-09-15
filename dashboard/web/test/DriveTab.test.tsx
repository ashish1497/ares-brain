import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { DriveTab, extractFolderId } from "../src/components/DriveTab";
import * as api from "../src/api";
import * as drivePicker from "../src/lib/drivePicker";

describe("extractFolderId", () => {
  test("passes through a bare folder ID unchanged", () => {
    expect(extractFolderId("1AbC-dEf_123")).toBe("1AbC-dEf_123");
  });

  test("extracts the ID out of a full Drive folder URL", () => {
    expect(extractFolderId("https://drive.google.com/drive/folders/1AbC-dEf_123?usp=sharing")).toBe(
      "1AbC-dEf_123",
    );
  });

  test("trims surrounding whitespace", () => {
    expect(extractFolderId("  1AbC123  ")).toBe("1AbC123");
  });
});

const COURSES = [{ slug: "ai-101", name: "AI 101" }];

function mockBase() {
  vi.spyOn(api, "getCourses").mockResolvedValue(COURSES);
  vi.spyOn(api, "getNotes").mockResolvedValue({ results: [] });
  vi.spyOn(api, "getStudy").mockResolvedValue({ items: [] });
}

afterEach(() => vi.restoreAllMocks());

test("no folder registered: shows Connect button, not a browse listing", async () => {
  mockBase();
  vi.spyOn(api, "getDriveFolders").mockResolvedValue({});
  render(<DriveTab />);
  expect(await screen.findByRole("button", { name: /connect via picker/i })).toBeInTheDocument();
  expect(screen.queryByText("What's shared")).not.toBeInTheDocument();
});

test("folder registered: shows Connected + browse listing, no Connect button", async () => {
  mockBase();
  vi.spyOn(api, "getDriveFolders").mockResolvedValue({ "ai-101": "FOLDER123" });
  vi.spyOn(api, "browseDrive").mockResolvedValue({
    connected: true,
    materials: [{ name: "a.md", link: null, modifiedTime: null }],
    transcripts: [],
    guide: null,
    notes: [],
    testprep: [],
  });
  render(<DriveTab />);
  expect(await screen.findByText("Connected")).toBeInTheDocument();
  expect(screen.getByText("FOLDER123")).toBeInTheDocument();
  expect(await screen.findByText("Materials: 1")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /connect via picker/i })).not.toBeInTheDocument();
});

test("manual connect: pasting a folder URL registers the extracted ID", async () => {
  mockBase();
  vi.spyOn(api, "getDriveFolders").mockResolvedValue({});
  const registerSpy = vi
    .spyOn(api, "registerDriveFolder")
    .mockResolvedValue({ ok: true, folders: { "ai-101": "PASTEDID" } });
  vi.spyOn(api, "browseDrive").mockResolvedValue({
    connected: true,
    materials: [],
    transcripts: [],
    guide: null,
    notes: [],
    testprep: [],
  });

  render(<DriveTab />);
  fireEvent.change(await screen.findByPlaceholderText(/paste drive folder/i), {
    target: { value: "https://drive.google.com/drive/folders/PASTEDID?usp=sharing" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));

  await waitFor(() => expect(registerSpy).toHaveBeenCalledWith("ai-101", "PASTEDID"));
  expect(await screen.findByText("Connected")).toBeInTheDocument();
});

test("manual connect's Connect button is disabled until something is typed", async () => {
  mockBase();
  vi.spyOn(api, "getDriveFolders").mockResolvedValue({});
  render(<DriveTab />);
  expect(await screen.findByRole("button", { name: "Connect" })).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText(/paste drive folder/i), {
    target: { value: "x" },
  });
  expect(screen.getByRole("button", { name: "Connect" })).not.toBeDisabled();
});

test("connecting: picks a folder, registers it, and the listing appears without a reload", async () => {
  mockBase();
  const foldersSpy = vi.spyOn(api, "getDriveFolders").mockResolvedValue({});
  vi.spyOn(drivePicker, "pickDriveFolder").mockResolvedValue("NEWFOLDER");
  const registerSpy = vi
    .spyOn(api, "registerDriveFolder")
    .mockResolvedValue({ ok: true, folders: { "ai-101": "NEWFOLDER" } });
  vi.spyOn(api, "browseDrive").mockResolvedValue({
    connected: true,
    materials: [],
    transcripts: [],
    guide: null,
    notes: [],
    testprep: [],
  });

  render(<DriveTab />);
  await waitFor(() => expect(foldersSpy).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole("button", { name: /connect via picker/i }));

  await waitFor(() => expect(registerSpy).toHaveBeenCalledWith("ai-101", "NEWFOLDER"));
  expect(await screen.findByText("Connected")).toBeInTheDocument();
});

test("cancelling the picker (null) leaves the course unconnected, no error shown", async () => {
  mockBase();
  vi.spyOn(api, "getDriveFolders").mockResolvedValue({});
  vi.spyOn(drivePicker, "pickDriveFolder").mockResolvedValue(null);
  const registerSpy = vi.spyOn(api, "registerDriveFolder");

  render(<DriveTab />);
  fireEvent.click(await screen.findByRole("button", { name: /connect via picker/i }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /connect via picker/i })).not.toBeDisabled(),
  );
  expect(registerSpy).not.toHaveBeenCalled();
});

test("a picker error is shown, not swallowed", async () => {
  mockBase();
  vi.spyOn(api, "getDriveFolders").mockResolvedValue({});
  vi.spyOn(drivePicker, "pickDriveFolder").mockRejectedValue(
    new drivePicker.DrivePickerError("No Drive access token available"),
  );

  render(<DriveTab />);
  fireEvent.click(await screen.findByRole("button", { name: /connect via picker/i }));

  expect(await screen.findByText(/No Drive access token available/)).toBeInTheDocument();
});

test("sharing a local note calls shareNote and shows the returned link", async () => {
  mockBase();
  vi.spyOn(api, "getDriveFolders").mockResolvedValue({ "ai-101": "FOLDER123" });
  vi.spyOn(api, "browseDrive").mockResolvedValue({
    connected: true,
    materials: [],
    transcripts: [],
    guide: null,
    notes: [],
    testprep: [],
  });
  vi.spyOn(api, "getNotes").mockResolvedValue({
    results: [{ path: "normalized/self-note-x.md", title: "My note", course: "ai-101" }],
  });
  const shareSpy = vi
    .spyOn(api, "shareNote")
    .mockResolvedValue({ ok: true, link: "https://drive/x" });

  render(<DriveTab />);
  fireEvent.click(await screen.findByRole("button", { name: "Share" }));

  await waitFor(() => expect(shareSpy).toHaveBeenCalledWith("ai-101", "normalized/self-note-x.md"));
  expect(await screen.findByText("https://drive/x")).toBeInTheDocument();
});

test("a failed share shows the error, not a silent no-op", async () => {
  mockBase();
  vi.spyOn(api, "getDriveFolders").mockResolvedValue({ "ai-101": "FOLDER123" });
  vi.spyOn(api, "browseDrive").mockResolvedValue({
    connected: true,
    materials: [],
    transcripts: [],
    guide: null,
    notes: [],
    testprep: [],
  });
  vi.spyOn(api, "getNotes").mockResolvedValue({
    results: [{ path: "normalized/x.md", title: "X", course: "ai-101" }],
  });
  vi.spyOn(api, "shareNote").mockResolvedValue({
    ok: false,
    link: null,
    error: "only self-note files may be shared",
  });

  render(<DriveTab />);
  fireEvent.click(await screen.findByRole("button", { name: "Share" }));

  expect(await screen.findByText(/failed: only self-note files may be shared/)).toBeInTheDocument();
});
