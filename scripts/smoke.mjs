/** Smoke-test the packed local artifact on the declared Node.js floor.
 * Usage: node scripts/smoke.mjs <path to the meuhedet-health bin>
 */
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";

const bin = process.argv[2];
assert.ok(bin, "usage: node scripts/smoke.mjs <path to the meuhedet-health bin>");

const help = await new Promise((resolve, reject) => {
  const child = spawn(bin, ["help"], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", chunk => { out += chunk; });
  child.on("error", reject);
  child.on("close", code => { code === 0 ? resolve(out) : reject(new Error(`meuhedet-health help exited ${code}`)); });
});
assert.match(help, /Usage: meuhedet-health <command>/);

const server = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
let buffer = "";
server.stdout.on("data", chunk => {
  buffer += chunk;
  for (let newline; (newline = buffer.indexOf("\n")) !== -1; ) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const settle = pending.get(message.id);
    if (settle) { pending.delete(message.id); settle(message); }
  }
});
const send = message => { server.stdin.write(`${JSON.stringify(message)}\n`); };
const call = (id, method, params) => new Promise(resolve => { pending.set(id, resolve); send({ jsonrpc: "2.0", id, method, params }); });
const deadline = setTimeout(() => { server.kill(); throw new Error("the MCP handshake did not complete in 60s"); }, 60_000);
try {
  const initialized = await call(1, "initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "meuhedet-floor-smoke", version: "0" },
  });
  assert.equal(initialized.error, undefined, `initialize failed: ${JSON.stringify(initialized.error)}`);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const listed = await call(2, "tools/list", {});
  assert.equal(listed.error, undefined, `tools/list failed: ${JSON.stringify(listed.error)}`);
  const tools = listed.result?.tools ?? [];
  assert.ok(tools.some(tool => tool.name === "meuhedet_lab_stickers"), "expected Meuhedet read tools");
  process.stdout.write(`${initialized.result.serverInfo.name} served ${tools.length} tools on ${process.version}\n`);
} finally {
  clearTimeout(deadline);
  server.kill();
}
