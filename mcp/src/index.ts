import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { statusTool } from "./tools/status.js";
import { scrapeTool } from "./tools/scrape.js";
import { transcribeTool } from "./tools/transcribe.js";
import { ingestTool } from "./tools/ingest.js";
import { brainQueryTool } from "./tools/brain_query.js";
import { brainNextSessionTool } from "./tools/brain_next_session.js";
import { brainStatusTool } from "./tools/brain_status.js";
import { calendarSyncTool } from "./tools/calendar_sync.js";
import { brainGetTool } from "./tools/brain_get.js";
import { dailyBriefTool } from "./tools/daily_brief.js";

const tools = [
  statusTool,
  scrapeTool,
  transcribeTool,
  ingestTool,
  brainQueryTool,
  brainNextSessionTool,
  brainStatusTool,
  calendarSyncTool,
  brainGetTool,
  dailyBriefTool,
];

const server = new Server({ name: "mesa", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) throw new Error(`unknown tool: ${req.params.name}`);
  const result = await (tool.handler as (a: Record<string, unknown>) => Promise<unknown>)(
    (req.params.arguments ?? {}) as Record<string, unknown>,
  );
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

await server.connect(new StdioServerTransport());
