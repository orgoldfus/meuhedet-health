import { startLocalMcp } from "./stdio";

export const MCP_USAGE = "Usage: meuhedet-health mcp\n";

/** A stdio server owns stdout until its client disconnects. */
export function awaitStdioShutdown(
  handle: { close(): Promise<void> },
  input: NodeJS.EventEmitter = process.stdin,
): Promise<number> {
  return new Promise(resolve => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      input.off("end", stop);
      input.off("close", stop);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void handle.close().then(() => resolve(0), () => resolve(1));
    };
    input.once("end", stop);
    input.once("close", stop);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export async function runMcp(args: string[]): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(`${MCP_USAGE}Run the read-only MCP server over stdio. Authenticate with the CLI first.\n`);
    return 0;
  }
  if (args.length) {
    process.stderr.write(`${MCP_USAGE}This server accepts no network, login, or record-changing options.\n`);
    return 2;
  }
  return await awaitStdioShutdown(startLocalMcp());
}
