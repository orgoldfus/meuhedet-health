import { describe, expect, it, vi } from "vitest";
import { CookieJar } from "tough-cookie";
import { MeuhedetAuth } from "../src/auth";
import { MeuhedetClient } from "../src/client";
import { AuthenticationError, ReauthenticationRequired, UpstreamError } from "../src/errors";
import { safeClinical } from "../src/privacy";
import { MeuhedetTransport, PORTAL_ORIGIN } from "../src/transport";

async function session() {
  const jar = new CookieJar();
  await jar.setCookie("portal=secret; Secure; HttpOnly; Path=/", PORTAL_ORIGIN);
  return { provider: "meuhedet" as const, version: 1 as const, cookies: await jar.serialize(), authenticatedAt: new Date().toISOString() };
}
describe("Meuhedet session and reads", () => {
  it("rejects a Maccabi or malformed imported session", async () => {
    const valid = await session();
    expect(() => new MeuhedetClient({ session: { ...valid, provider: "maccabi" } as never })).toThrow("could not be completed");
    expect(() => new MeuhedetClient({ session: { ...valid, cookies: { cookies: [{ domain: "evil.example" }] } } as never })).toThrow();
  });
  it("follows only two permitted HTTPS origins and never forwards credentials elsewhere", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 302, headers: { location: "https://evil.example/receive" } }));
    const transport = new MeuhedetTransport({ fetch });
    await expect(transport.request(PORTAL_ORIGIN + "/")).rejects.toMatchObject({ code: "UNSUPPORTED_ORIGIN" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(PORTAL_ORIGIN + "/");
  });
  it("does not replay a POST body across even an allowlisted 307", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(null, { status: 307, headers: { location: PORTAL_ORIGIN + "/signin-oidc" } }));
    const transport = new MeuhedetTransport({ fetch });
    await expect(transport.request("https://login.meuhedet.co.il/Account/Verify", {
      method: "POST", body: "VerificationCode=123456",
    })).rejects.toMatchObject({ code: "CROSS_ORIGIN_POST_REDIRECT" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("clears a session on a portal redirect to login", async () => {
    const transport = new MeuhedetTransport({
      session: await session(),
      fetch: async () => new Response(null, { status: 302, headers: { location: "https://login.meuhedet.co.il/Account/Login" } }),
    });
    await expect(transport.request(PORTAL_ORIGIN + "/umbraco/api/PersonalDashboardApi/LabStickers")).rejects.toBeInstanceOf(ReauthenticationRequired);
    await expect(transport.exportSession()).rejects.toBeInstanceOf(ReauthenticationRequired);
  });
  it("uses observed lab URL and rejects a 200 HTML login page", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const client = new MeuhedetClient({ session: await session(), fetch });
    await expect(client.labStickers()).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    await expect(client.exportSession()).rejects.toBeInstanceOf(ReauthenticationRequired);
    expect(fetch.mock.calls[0][0].toString()).toMatch(/^https:\/\/online\.meuhedet\.co\.il\/umbraco\/api\/PersonalDashboardApi\/LabStickers\?uniq_param=\d+$/);
  });
  it("checks the first-party dashboard collection before returning clinical data", async () => {
    const client = new MeuhedetClient({ session: await session(), fetch: async () =>
      new Response(JSON.stringify({ Stickers: [{ LabCode: "123", StickerId: "abc", patientId: "private" }] }), {
        headers: { "content-type": "application/json" },
      }) });
    expect(await client.labStickers()).toEqual({ Stickers: [{ LabCode: "123", StickerId: "abc" }] });
    const changed = new MeuhedetClient({ session: await session(), fetch: async () =>
      new Response(JSON.stringify({ Message: "unexpected" }), { headers: { "content-type": "application/json" } }) });
    await expect(changed.labStickers()).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE_SHAPE" });
  });
  it("filters sensitive keys recursively while retaining clinical values", () => {
    expect(safeClinical({ Items: [{ LabCode: "BLOOD", patientId: "123", nested: { token: "secret", value: 4 } }] }))
      .toEqual({ Items: [{ LabCode: "BLOOD", nested: { value: 4 } }] });
  });
  it("caps patient API bodies before parsing", async () => {
    const client = new MeuhedetClient({ session: await session(), fetch: async () =>
      new Response("x".repeat(2_000_001), { headers: { "content-type": "application/json" } }) });
    await expect(client.prescriptions()).rejects.toBeInstanceOf(UpstreamError);
  });
});
describe("login fail-closed behavior", () => {
  it("submits only fields from the observed first-step and OTP forms and confirms portal API", async () => {
    const sent: Array<{ url: string; method: string; body: string }> = [];
    const html = (content: string, url: string) => {
      const response = new Response(content, { headers: { "content-type": "text/html" } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    };
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      sent.push({ url, method: init?.method ?? "GET", body: init?.body?.toString() ?? "" });
      if (url.includes("/umbraco/api/PersonalDashboardApi/LabStickers"))
        return new Response(JSON.stringify({ Stickers: [] }), { headers: { "content-type": "application/json" } });
      if (url === PORTAL_ORIGIN + "/signin-oidc")
        return html("<html>portal</html>", PORTAL_ORIGIN + "/account");
      if (url.endsWith("/Account/Verify"))
        return html('<form method="post" action="https://online.meuhedet.co.il/signin-oidc"><input name="id_token" value="id"><input name="state" value="state"></form>', "https://login.meuhedet.co.il/Account/Verify");
      if (url.endsWith("/Account/FirstStepLogin"))
        return html('<form method="post" action="/Account/Verify"><input type="hidden" name="__RequestVerificationToken" value="csrf2"><input name="VerificationCode"></form>', url);
      return html('<form method="post" action="/Account/FirstStepLogin"><input name="Username"><input name="MobilePhoneNumber"><input type="hidden" name="ReturnUrl" value="/connect/authorize"><input type="hidden" name="__RequestVerificationToken" value="csrf1"></form>', "https://login.meuhedet.co.il/Account/Login");
    });
    const auth = new MeuhedetAuth({ fetch });
    const challenge = await auth.beginLogin({ username: "123456789", mobilePhoneNumber: "0521234567" });
    expect(challenge.step).toBe("otp");
    expect(sent[1].body).toContain("Username=123456789");
    expect(sent[1].body).toContain("__RequestVerificationToken=csrf1");
    const result = await auth.completeLogin(challenge.id, "123456");
    expect(result.provider).toBe("meuhedet");
    expect(sent[2].body).toContain("VerificationCode=123456");
    expect(sent[3].body).toContain("id_token=id");
  });
  it("does not submit identifiers when the login form is unverified", async () => {
    const fetch = vi.fn(async () => new Response("<html><form action='/Account/Unknown'></form></html>", {
      headers: { "content-type": "text/html" },
    }));
    const auth = new MeuhedetAuth({ fetch });
    await expect(auth.beginLogin({ username: "123456789", mobilePhoneNumber: "0521234567" }))
      .rejects.toMatchObject({ code: "LOGIN_PAGE_CHANGED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("follows the observed login page link before submitting identifiers", async () => {
    const calls: string[] = [];
    const html = (body: string, url: string) => {
      const response = new Response(body, { headers: { "content-type": "text/html" } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    };
    const auth = new MeuhedetAuth({ fetch: async (input, init) => {
      const url = input.toString(); calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/Account/FirstStepLogin") && init?.method === "POST")
        return html("<html>No verified OTP form</html>", url);
      if (url.endsWith("/Account/FirstStepLogin"))
        return html('<form method="post" action="/Account/FirstStepLogin"><input name="Username"><input name="MobilePhoneNumber"><input name="ReturnUrl"><input name="__RequestVerificationToken"></form>', url);
      return html('<a href="/Account/FirstStepLogin">Sign in</a>', "https://login.meuhedet.co.il/Account/Login");
    } });
    await expect(auth.beginLogin({ username: "123456789", mobilePhoneNumber: "0521234567" }))
      .rejects.toMatchObject({ code: "OTP_FORM_UNVERIFIED" });
    expect(calls).toEqual([
      `GET ${new URL("/הבדיקות-שלי/בדיקות-מעבדה/", PORTAL_ORIGIN).href}`,
      "GET https://login.meuhedet.co.il/Account/FirstStepLogin",
      "POST https://login.meuhedet.co.il/Account/FirstStepLogin",
    ]);
  });
  it("validates identifier and phone locally", async () => {
    const fetch = vi.fn();
    const auth = new MeuhedetAuth({ fetch });
    await expect(auth.beginLogin({ username: "bad", mobilePhoneNumber: "0521234567" })).rejects.toBeInstanceOf(AuthenticationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
