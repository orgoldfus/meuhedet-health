import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, it } from "vitest";

it("starts the built stdio entry and never prints clinical content on stdout outside MCP", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js", "mcp"],
    cwd: new URL("../../../", import.meta.url).pathname,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools;
    expect(tools.length).toBe(14);
    const status = await client.callTool({ name: "meuhedet_session_status", arguments: {} });
    expect(JSON.stringify(status)).toContain("sessionSaved");
    expect(stderr).toBe("");
  } finally { await client.close(); }
});
