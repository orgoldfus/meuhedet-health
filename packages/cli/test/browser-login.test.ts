import { afterEach, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";
import type { MeuhedetSession } from "@meuhedet/core";
import { startBrowserLogin } from "../src/browser-login";

const flows: Awaited<ReturnType<typeof startBrowserLogin>>[] = [];
afterEach(async () => { await Promise.all(flows.splice(0).map(flow => flow.close())); });
async function fixture(timeoutMs?: number) {
  const session = { version: 1, provider: "meuhedet", cookies: { cookies: [] }, authenticatedAt: "2026-01-01T00:00:00.000Z" } as unknown as MeuhedetSession;
  const auth = {
    beginLogin: vi.fn(async () => ({ id: "synthetic-challenge" })),
    completeLogin: vi.fn(async () => session),
    cancelLogin: vi.fn(async () => {}),
  };
  const save = vi.fn(async (_value: MeuhedetSession) => {});
  const flow = await startBrowserLogin({ auth, save, timeoutMs });
  flows.push(flow);
  const url = new URL(flow.url);
  const headers = { authorization: `Bearer ${url.hash.slice(1)}`, origin: url.origin, "content-type": "application/json" };
  const request = (path: string, body?: object, overrides: Record<string, string> = {}) => fetch(url.origin + path, {
    method: body ? "POST" : "GET", headers: { ...headers, ...overrides }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { auth, save, flow, request, url, headers };
}
const credentials = { username: "123456789", mobilePhoneNumber: "0521234567" };

it("completes sign-in and persists only the verified session without returning credentials", async () => {
  const f = await fixture();
  const page = await fetch(f.url.origin);
  expect(page.headers.get("cache-control")).toBe("no-store");
  expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const html = await page.text();
  expect(html).not.toContain(f.url.hash.slice(1));
  expect(html).toContain("history.replaceState");
  expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
  expect(await (await f.request("/state")).json()).toEqual({ state: "credentials" });
  expect(await (await f.request("/credentials", credentials)).json()).toEqual({ state: "otp" });
  expect(f.auth.beginLogin).toHaveBeenCalledWith(credentials);
  expect(f.save).not.toHaveBeenCalled();
  expect(await (await f.request("/otp", { code: "123456" })).json()).toEqual({ state: "complete" });
  expect(await f.flow.completion).toBeUndefined();
  expect(f.auth.completeLogin).toHaveBeenCalledWith("synthetic-challenge", "123456");
  expect(f.save).toHaveBeenCalledTimes(1);
  expect((await f.request("/otp", { code: "123456" })).status).toBe(409);
});

it("rejects missing capabilities, cross-origin submissions and DNS rebinding", async () => {
  const f = await fixture();
  expect((await f.request("/credentials", credentials, { authorization: "" })).status).toBe(403);
  expect((await f.request("/credentials", credentials, { origin: "https://evil.example" })).status).toBe(403);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(f.url.origin, { headers: { host: "evil.example" } }, res => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
  expect(status).toBe(403);
  expect((await fetch(f.url.origin + "/state")).status).toBe(403);
  expect(f.auth.beginLogin).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it("rejects malformed, oversized and out-of-order submissions without calling Meuhedet", async () => {
  const f = await fixture();
  expect((await f.request("/otp", { code: "123456" })).status).toBe(409);
  expect((await f.request("/credentials", { ...credentials, extra: "unexpected" })).status).toBe(400);
  expect((await f.request("/credentials", { ...credentials, username: "x".repeat(3000) })).status).toBe(400);
  expect((await fetch(f.url.origin + "/credentials", { method: "POST", headers: f.headers, body: "{" })).status).toBe(400);
  expect(f.auth.beginLogin).not.toHaveBeenCalled();
});

it("blocks duplicate submissions while a sign-in request is in progress", async () => {
  const f = await fixture();
  let resolve!: (value: { id: string }) => void;
  f.auth.beginLogin.mockImplementation(() => new Promise(done => { resolve = done; }));
  const first = f.request("/credentials", credentials);
  await vi.waitFor(() => expect(f.auth.beginLogin).toHaveBeenCalledTimes(1));
  expect((await f.request("/credentials", credentials)).status).toBe(409);
  expect((await f.request("/cancel", {})).status).toBe(409);
  resolve({ id: "synthetic-challenge" });
  expect((await first).status).toBe(200);
});

it("does not return upstream errors or save a session after failed authentication", async () => {
  const f = await fixture();
  await f.request("/credentials", credentials);
  f.auth.completeLogin.mockRejectedValue(new Error("cookie=private-fixture patient=private-fixture"));
  const response = await f.request("/otp", { code: "123456" });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private-fixture");
  expect((await f.flow.completion)?.code).toBe("BROWSER_LOGIN_FAILED");
  expect(f.save).not.toHaveBeenCalled();
});

it("reports persistence failure as failure rather than successful sign-in", async () => {
  const f = await fixture();
  await f.request("/credentials", credentials);
  f.save.mockRejectedValue(new Error("private filesystem path"));
  expect((await f.request("/otp", { code: "123456" })).status).toBe(500);
  expect((await f.flow.completion)?.code).toBe("BROWSER_LOGIN_FAILED");
});

it("cancels without saving a session", async () => {
  const f = await fixture();
  expect(await (await f.request("/cancel", {})).json()).toEqual({ state: "cancelled" });
  expect((await f.flow.completion)?.code).toBe("BROWSER_LOGIN_CANCELLED");
  expect((await f.request("/credentials", credentials)).status).toBe(409);
  expect(f.save).not.toHaveBeenCalled();
});

it("does not persist an authentication that finishes after the local flow expires", async () => {
  const f = await fixture(250);
  await f.request("/credentials", credentials);
  let resolve!: (value: MeuhedetSession) => void;
  f.auth.completeLogin.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = f.request("/otp", { code: "123456" });
  await vi.waitFor(() => expect(f.auth.completeLogin).toHaveBeenCalled());
  expect((await f.flow.completion)?.code).toBe("BROWSER_LOGIN_EXPIRED");
  resolve({} as MeuhedetSession);
  expect((await pending).status).toBe(410);
  expect(f.save).not.toHaveBeenCalled();
});
