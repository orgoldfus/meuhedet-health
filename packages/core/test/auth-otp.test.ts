import { describe, expect, it, vi } from "vitest";
import { MeuhedetAuth } from "../src/auth";
import { LOGIN_ORIGIN, PORTAL_ORIGIN } from "../src/transport";

const firstStep = `<form method="post" action="/Account/FirstStepLogin">
  <input name="Username"><input name="MobilePhoneNumber"><input name="ReturnUrl">
  <input name="__RequestVerificationToken" value="csrf1"></form>`;
const otpBoxes = Array.from({ length: 6 }, (_, index) =>
  `<input type="text" inputmode="numeric" autocomplete="one-time-code" aria-label="קוד חד פעמי, ספרה מספר ${index + 1}">`).join("");
function html(body: string, url: string): Response {
  const response = new Response(body, { headers: { "content-type": "text/html" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
function fakeLogin(challengeHtml: string) {
  const posts: Array<{ url: string; body: URLSearchParams }> = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (init?.method === "POST") posts.push({ url, body: new URLSearchParams(init.body?.toString()) });
    if (url === PORTAL_ORIGIN + "/signin-oidc") return html("<html>portal</html>", PORTAL_ORIGIN + "/account");
    if (url.includes("/umbraco/api/AppointmentApi/FutureAppointmentsOnly"))
      return new Response(JSON.stringify({ Items: [] }), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/Account/Verify")) return html(
      `<form method="post" action="${PORTAL_ORIGIN}/signin-oidc"><input name="id_token" value="token"><input name="state" value="state"></form>`, url);
    if (url.endsWith("/Account/FirstStepLogin")) return html(challengeHtml, url);
    return html(firstStep, LOGIN_ORIGIN + "/Account/Login");
  });
  return { auth: new MeuhedetAuth({ fetch }), fetch, posts };
}
const details = { username: "123456789", mobilePhoneNumber: "0521234567" };
describe("unnamed OTP digit boxes", () => {
  it.each([1, 2, 3, 4, 5, 6])("accepts one explicitly labeled OTP control %s with a response-supplied hidden code field", async digit => {
    const { auth, posts } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="csrf2">
      <input type="hidden" name="VerificationCode" value="">
      <input type="text" inputmode="numeric" autocomplete="one-time-code" aria-label="קוד חד פעמי, ספרה מספר ${digit}"></form>`);
    const challenge = await auth.beginLogin(details);
    await auth.completeLogin(challenge.id, "123456");
    expect(posts[1].url).toBe(LOGIN_ORIGIN + "/Account/Verify");
    expect([...posts[1].body]).toEqual([
      ["__RequestVerificationToken", "csrf2"], ["VerificationCode", "123456"],
    ]);
  });
  it("does not invent a hidden code field for the observed single-control shape", async () => {
    const { auth, posts } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="csrf2">
      <input type="text" autocomplete="one-time-code" aria-label="קוד חד פעמי, ספרה מספר 1"></form>`);
    await expect(auth.beginLogin(details)).rejects.toMatchObject({
      code: "OTP_FORM_UNVERIFIED", diagnostics: { unnamedDigitCount: 1, recognizedDigitCount: 1, hiddenCodeFieldCount: 0, candidateCount: 0 },
    });
    expect(posts).toHaveLength(1);
  });
  it("rejects ambiguous hidden code fields with one labeled control", async () => {
    const { auth, posts } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="csrf2">
      <input type="hidden" name="VerificationCode" value=""><input type="hidden" name="OtpCode" value="">
      <input type="text" autocomplete="one-time-code" aria-label="קוד חד פעמי, ספרה מספר 1"></form>`);
    await expect(auth.beginLogin(details)).rejects.toMatchObject({ code: "OTP_FORM_UNVERIFIED", diagnostics: { hiddenCodeFieldCount: 2, candidateCount: 2 } });
    expect(posts).toHaveLength(1);
  });
  it.each([2, 3, 4, 5])("rejects an incomplete group of %s digit controls", async length => {
    const boxes = Array.from({ length }, (_, index) =>
      `<input type="text" autocomplete="one-time-code" aria-label="קוד חד פעמי, ספרה מספר ${index + 1}">`).join("");
    const { auth, posts } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="csrf2">
      <input type="hidden" name="VerificationCode" value="">${boxes}</form>`);
    await expect(auth.beginLogin(details)).rejects.toMatchObject({ code: "OTP_FORM_UNVERIFIED", diagnostics: { hiddenCodeFieldCount: 1, candidateCount: 0 } });
    expect(posts).toHaveLength(1);
  });
  it.each(["קוד חד פעמי, ספרה מספר 7", "SMS code"])("rejects an unrecognized singleton label %s", async label => {
    const { auth, posts } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="csrf2">
      <input type="hidden" name="VerificationCode" value="">
      <input type="text" autocomplete="one-time-code" aria-label="${label}"></form>`);
    await expect(auth.beginLogin(details)).rejects.toMatchObject({ code: "OTP_FORM_UNVERIFIED", diagnostics: { recognizedDigitCount: 0, hiddenCodeFieldCount: 1, candidateCount: 0 } });
    expect(posts).toHaveLength(1);
  });
  it("submits the named hidden field supplied by the challenge form", async () => {
    const { auth, posts } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="csrf2">
      <input type="hidden" name="VerificationCode" value="">${otpBoxes}</form>`);
    const challenge = await auth.beginLogin(details);
    await auth.completeLogin(challenge.id, "123456");
    expect(posts[1].url).toBe(LOGIN_ORIGIN + "/Account/Verify");
    expect([...posts[1].body]).toEqual([
      ["__RequestVerificationToken", "csrf2"], ["VerificationCode", "123456"],
    ]);
  });
  it("rejects unnamed boxes without a named code field before an OTP POST", async () => {
    const { auth, posts } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="csrf2">${otpBoxes}</form>`);
    await expect(auth.beginLogin(details)).rejects.toMatchObject({ code: "OTP_FORM_UNVERIFIED" });
    expect(posts).toHaveLength(1);
  });
  it("rejects ambiguous named code fields before an OTP POST", async () => {
    const { auth, posts } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="csrf2">
      <input type="hidden" name="VerificationCode" value=""><input type="hidden" name="OtpCode" value="">${otpBoxes}</form>`);
    await expect(auth.beginLogin(details)).rejects.toMatchObject({ code: "OTP_FORM_UNVERIFIED" });
    expect(posts).toHaveLength(1);
  });
  it("requires all six labeled boxes to accept a hidden code field", async () => {
    const { auth, posts } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="csrf2">
      <input type="hidden" name="VerificationCode" value="">${otpBoxes.replace('ספרה מספר 6', 'ספרה מספר 5')}</form>`);
    await expect(auth.beginLogin(details)).rejects.toMatchObject({ code: "OTP_FORM_UNVERIFIED" });
    expect(posts).toHaveLength(1);
  });
  it("reports only structural diagnostics for an unverified form, never its content or field values", async () => {
    const { auth } = fakeLogin(`<form method="post" action="/Account/Verify">
      <input type="hidden" name="__RequestVerificationToken" value="sensitive-HTML-value">
      <div class="validation-summary-errors">sensitive-HTML-value</div>${otpBoxes}</form>`);
    const error = await auth.beginLogin(details).catch(e => e);
    expect(error).toMatchObject({ code: "OTP_FORM_UNVERIFIED", diagnostics: { formCount: 1, unnamedDigitCount: 6, recognizedDigitCount: 6, candidateCount: 0, validationErrorPresent: true, loginFormReturned: false } });
    expect(JSON.stringify(error.diagnostics)).not.toMatch(/sensitive-HTML-value|123456789|0521234567|VerificationToken/);
  });
  it("distinguishes a returned first-step form without claiming that an SMS was sent", async () => {
    const { auth } = fakeLogin(firstStep);
    await expect(auth.beginLogin(details)).rejects.toMatchObject({ code: "LOGIN_NOT_ADVANCED", diagnostics: { loginFormReturned: true, candidateCount: 0, codeFieldCount: 0 } });
  });
});
