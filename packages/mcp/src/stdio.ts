import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { createMeuhedetMcpServer, type McpOptions } from "./tools";
export function startLocalMcp(options: McpOptions = {}): StdioServerHandle {
  return serveStdio(() => createMeuhedetMcpServer(options), {
    onerror: () => process.stderr.write("Meuhedet MCP transport error.\n"),
  });
}
