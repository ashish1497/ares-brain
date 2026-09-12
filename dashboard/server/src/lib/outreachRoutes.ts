/** HTTP layer for the outreach/GTM agent. Delegated to from index.ts's
 * handle() — returns true once it has written a response, so the caller
 * knows not to fall through to the static-file handler. */

import type { IncomingMessage, ServerResponse } from "node:http";
import { match } from "./router.js";
import {
  createSession,
  getSession,
  SECTION_ORDER,
  type OutreachState,
  type Section,
} from "./outreachStore.js";
import {
  UserFacingError,
  runIcp,
  runIndustry,
  runCompany,
  runPeople,
  runOutreach,
  runVerify,
  runVerifyMessages,
} from "./outreach.js";

const VERIFIABLE_SECTIONS: Section[] = ["company", "people"];

function json(res: ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(s),
  });
  res.end(s);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function publicState(state: OutreachState) {
  return {
    myCompany: state.myCompany,
    whatIDo: state.whatIDo,
    targetAccount: state.targetAccount,
    sections: state.sections,
    edited: state.edited,
    verification: state.verification,
    doNotUse: state.doNotUse,
  };
}

function requireSession(id: unknown): OutreachState {
  if (typeof id !== "string" || !id) throw new UserFacingError("session_id required.");
  const state = getSession(id);
  if (!state)
    throw new UserFacingError("This session has expired or the server restarted. Start over.", 404);
  return state;
}

async function runSection(
  state: OutreachState,
  section: Section,
): Promise<Record<string, unknown>> {
  const { myCompany, whatIDo, targetAccount, sections } = state;
  if (section === "icp") return runIcp(myCompany, whatIDo);
  if (!targetAccount) throw new UserFacingError("Pick a target account before running this step.");
  if (section === "industry")
    return runIndustry(myCompany, whatIDo, sections.icp ?? {}, targetAccount);
  if (section === "company")
    return runCompany(myCompany, whatIDo, targetAccount, sections.industry ?? {});
  if (section === "people")
    return runPeople(myCompany, whatIDo, targetAccount, sections.company ?? {});
  if (section === "outreach")
    return runOutreach(
      myCompany,
      whatIDo,
      targetAccount,
      sections.company ?? {},
      sections.people ?? {},
      state.doNotUse,
    );
  throw new UserFacingError("Unknown section.");
}

/** Returns true if this request was an outreach-agent route (handled either
 * way — success or error response already written). */
export async function handleOutreachRoute(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  url: string,
): Promise<boolean> {
  try {
    if (match("POST", "/api/outreach/session", method, url)) {
      const body = await readJsonBody(req);
      const myCompany = String(body.myCompany ?? "").trim();
      const whatIDo = String(body.whatIDo ?? "").trim();
      if (!myCompany || !whatIDo)
        throw new UserFacingError("Tell me your company name and what you do first.");
      const { id, state } = createSession(myCompany, whatIDo);
      json(res, 200, { sessionId: id, state: publicState(state) });
      return true;
    }

    if (match("POST", "/api/outreach/company-info", method, url)) {
      const body = await readJsonBody(req);
      const state = requireSession(body.sessionId);
      const myCompany = String(body.myCompany ?? "").trim();
      const whatIDo = String(body.whatIDo ?? "").trim();
      if (!myCompany || !whatIDo)
        throw new UserFacingError("Company name and what you do can't be empty.");
      state.myCompany = myCompany;
      state.whatIDo = whatIDo;
      json(res, 200, { state: publicState(state) });
      return true;
    }

    if (match("POST", "/api/outreach/target", method, url)) {
      const body = await readJsonBody(req);
      const state = requireSession(body.sessionId);
      const targetAccount = String(body.targetAccount ?? "").trim();
      if (!targetAccount) throw new UserFacingError("Pick or type a target account first.");
      state.targetAccount = targetAccount;
      for (const section of ["industry", "company", "people", "outreach"] as const) {
        state.sections[section] = null;
        state.edited[section] = false;
      }
      state.verification = {};
      state.doNotUse = [];
      json(res, 200, { state: publicState(state) });
      return true;
    }

    if (match("POST", "/api/outreach/edit", method, url)) {
      const body = await readJsonBody(req);
      const state = requireSession(body.sessionId);
      const section = body.section as Section;
      if (!SECTION_ORDER.includes(section)) throw new UserFacingError("Unknown section.");
      if (typeof body.content !== "object" || body.content === null)
        throw new UserFacingError("Edited content must be an object.");
      state.sections[section] = body.content as Record<string, unknown>;
      state.edited[section] = true;
      json(res, 200, { state: publicState(state) });
      return true;
    }

    const stateParams = match("GET", "/api/outreach/state/:sessionId", method, url);
    if (stateParams) {
      const state = requireSession(stateParams.sessionId);
      json(res, 200, { state: publicState(state) });
      return true;
    }

    const runParams = match("POST", "/api/outreach/run/:section", method, url);
    if (runParams) {
      const section = runParams.section as Section;
      if (!SECTION_ORDER.includes(section)) throw new UserFacingError("Unknown section.");
      const body = await readJsonBody(req);
      const state = requireSession(body.sessionId);
      const content = await runSection(state, section);
      state.sections[section] = content;
      state.edited[section] = false;
      json(res, 200, { section, content, state: publicState(state) });
      return true;
    }

    if (match("POST", "/api/outreach/verify-messages", method, url)) {
      const body = await readJsonBody(req);
      const state = requireSession(body.sessionId);
      const outreach = state.sections.outreach;
      if (!outreach)
        throw new UserFacingError("Run the outreach step before grading its messages.");
      const result = await runVerifyMessages(
        outreach,
        {
          icp: state.sections.icp,
          industry: state.sections.industry,
          company: state.sections.company,
          people: state.sections.people,
        },
        state.doNotUse,
      );
      state.verification.outreach = result;
      json(res, 200, { section: "outreach", result, state: publicState(state) });
      return true;
    }

    const verifyParams = match("POST", "/api/outreach/verify/:section", method, url);
    if (verifyParams) {
      const section = verifyParams.section as Section;
      if (!VERIFIABLE_SECTIONS.includes(section))
        throw new UserFacingError("This section has nothing gradeable — verify company or people.");
      const body = await readJsonBody(req);
      const state = requireSession(body.sessionId);
      const content = state.sections[section];
      if (!content) throw new UserFacingError("Run this step before grading it.");
      const result = await runVerify(section, content);
      state.verification[section] = result;
      const newBans = Array.isArray(result.do_not_use) ? (result.do_not_use as string[]) : [];
      state.doNotUse = Array.from(new Set([...state.doNotUse, ...newBans]));
      json(res, 200, { section, result, state: publicState(state) });
      return true;
    }

    return false;
  } catch (err) {
    if (err instanceof UserFacingError) {
      json(res, err.statusCode, { error: err.message });
    } else {
      json(res, 500, { error: "Something went wrong on the server. Please try again." });
    }
    return true;
  }
}
