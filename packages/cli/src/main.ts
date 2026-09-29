#!/usr/bin/env node
import { runCli } from "./cli";
if (process.argv[2] === "mcp") {
  const { runMcp } = await import("../../mcp/src/main");
  process.exitCode = await runMcp(process.argv.slice(3));
} else {
  process.exitCode = await runCli(process.argv.slice(2));
}
