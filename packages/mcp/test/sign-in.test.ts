import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it, vi } from "vitest";
import type { MeuhedetSession } from "@meuhedet/core";
import { createMeuhedetMcpServer } from "../src/tools";
import type { LoginDetails } from "../src/sign-in";
import { Script } from "node:vm";

const connections: Array<{ client: Client; server: ReturnType<typeof createMeuhedetMcpServer> }> = [];
afterEach(async () => { for (const { client, server } of connections.splice(0)) { await client.close(); await server.close(); } });
async function fixture(initialProfile: LoginDetails | null = null) {
  let saved: MeuhedetSession | null = null;
  let profile = initialProfile;
  let clock = 0;
  const session = { provider: "meuhedet", version: 1, authenticatedAt: "2026-01-01", cookies: { cookies: [] } } as unknown as MeuhedetSession;
  const auth = {
    beginLogin: vi.fn(async () => ({ id: "synthetic-challenge" })),
    completeLogin: vi.fn(async () => session),
    cancelLogin: vi.fn(async () => {}),
  };
  const save = vi.fn(async (value: MeuhedetSession) => { saved = value; });
  const profileSave = vi.fn(async (value: LoginDetails) => { profile = value; });
  const profileDelete = vi.fn(async () => { profile = null; });
  const server = createMeuhedetMcpServer({ store: { load: async () => saved, save, delete: async () => { saved = null; } }, profileStore: { load: async () => profile, save: profileSave, delete: profileDelete }, createAuth: () => auth, now: () => clock });
  const client = new Client({ name: "sign-in-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  connections.push({ client, server });
  const start = () => client.callTool({ name: "meuhedet_sign_in", arguments: {} });
  const action = (flowId: unknown, action: string, fields = {}) => client.callTool({ name: "meuhedet_sign_in_action", arguments: { flowId, action, ...fields } });
  return { client, auth, save, profileSave, profileDelete, start, action, clearSession: () => { saved = null; }, advance: () => { clock += 600_001; } };
}

it("exposes a native UI resource and keeps credential submission tools app-only", async () => {
  const f = await fixture();
  const tools = (await f.client.listTools()).tools;
  const launcher = tools.find(tool => tool.name === "meuhedet_sign_in")!;
  const action = tools.find(tool => tool.name === "meuhedet_sign_in_action")!;
  expect(launcher.inputSchema.properties).toEqual({});
  expect(action._meta).toEqual({ ui: { visibility: ["app"] } });
  const uri = (launcher._meta?.ui as { resourceUri: string }).resourceUri;
  const resource = await f.client.readResource({ uri });
  const content = resource.contents[0];
  expect(content.mimeType).toBe("text/html;profile=mcp-app");
  const html = "text" in content ? content.text : "";
  expect(html).toContain("ui/initialize");
  expect(html).toContain("tools/call");
  expect(() => new Script(html.match(/<script>([\s\S]*)<\/script>/)![1])).not.toThrow();
  expect(html).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});

it("keeps the flow capability out of model-facing output and never echoes credentials", async () => {
  const f = await fixture();
  const started = await f.start();
  const id = started._meta?.flowId;
  expect(id).toBeTypeOf("string");
  expect(JSON.stringify(started.content)).not.toContain(id as string);
  expect(started.structuredContent).toEqual({ state: "credentials" });
  const otp = await f.action(id, "credentials", { username: "123456789", mobilePhoneNumber: "0521234567" });
  expect(otp.structuredContent).toEqual({ state: "otp" });
  expect(JSON.stringify(otp)).not.toContain("123456789");
  expect(JSON.stringify(otp)).not.toContain("0521234567");
  expect(f.save).not.toHaveBeenCalled();
  expect(f.profileSave).not.toHaveBeenCalled();
  const done = await f.action(id, "otp", { code: "123456" });
  expect(done.structuredContent).toEqual({ state: "complete" });
  expect(JSON.stringify(done)).not.toContain("123456");
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.profileSave).toHaveBeenCalledWith({ username: "123456789", mobilePhoneNumber: "0521234567" });
  expect((await f.start()).structuredContent).toEqual({ state: "complete" });
  await f.action(id, "otp", { code: "123456" });
  expect(f.save).toHaveBeenCalledTimes(1);
});

it("rejects wrong capabilities and out-of-order actions before transmitting credentials", async () => {
  const f = await fixture();
  const started = await f.start();
  expect((await f.action("00000000-0000-4000-8000-000000000000", "credentials", { username: "123456789", mobilePhoneNumber: "0521234567" })).isError).toBe(true);
  expect((await f.action(started._meta?.flowId, "otp", { code: "123456" })).isError).toBe(true);
  expect(f.auth.beginLogin).not.toHaveBeenCalled();
  expect(f.auth.completeLogin).not.toHaveBeenCalled();
});

it("does not persist expired or cancelled flows", async () => {
  const f = await fixture();
  const started = await f.start();
  await f.action(started._meta?.flowId, "credentials", { username: "123456789", mobilePhoneNumber: "0521234567" });
  f.advance();
  expect((await f.action(started._meta?.flowId, "otp", { code: "123456" })).structuredContent).toEqual({ state: "expired" });
  expect(f.save).not.toHaveBeenCalled();
  const next = await f.start();
  expect(next._meta?.flowId).not.toBe(started._meta?.flowId);
  expect((await f.action(next._meta?.flowId, "cancel")).structuredContent).toEqual({ state: "cancelled" });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.profileSave).not.toHaveBeenCalled();
});

it("does not expose upstream secrets on authentication failure", async () => {
  const f = await fixture();
  const started = await f.start();
  f.auth.beginLogin.mockRejectedValue(new Error("cookie=synthetic-private-value"));
  const result = await f.action(started._meta?.flowId, "credentials", { username: "123456789", mobilePhoneNumber: "0521234567" });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain("synthetic-private-value");
  expect(f.save).not.toHaveBeenCalled();
  expect(f.profileSave).not.toHaveBeenCalled();
});

it("reuses a saved profile after session expiry without returning personal details", async () => {
  const details = { username: "123456789", mobilePhoneNumber: "0521234567" };
  const f = await fixture(details);
  const started = await f.start();
  expect(started._meta?.hasSavedDetails).toBe(true);
  expect(JSON.stringify(started)).not.toContain(details.username);
  expect(JSON.stringify(started)).not.toContain(details.mobilePhoneNumber);
  expect((await f.action(started._meta?.flowId, "saved")).structuredContent).toEqual({ state: "otp" });
  expect(f.auth.beginLogin).toHaveBeenCalledWith(details);
  await f.action(started._meta?.flowId, "otp", { code: "123456" });
  f.clearSession();
  const again = await f.start();
  expect(again._meta?.hasSavedDetails).toBe(true);
  expect((await f.action(again._meta?.flowId, "saved")).structuredContent).toEqual({ state: "otp" });
});

it("forgets saved details and requires new credentials before requesting SMS", async () => {
  const f = await fixture({ username: "123456789", mobilePhoneNumber: "0521234567" });
  const started = await f.start();
  const forgotten = await f.action(started._meta?.flowId, "forget");
  expect(forgotten._meta?.hasSavedDetails).toBe(false);
  expect(f.profileDelete).toHaveBeenCalledOnce();
  expect((await f.action(started._meta?.flowId, "saved")).isError).toBe(true);
  expect(f.auth.beginLogin).not.toHaveBeenCalled();
});
