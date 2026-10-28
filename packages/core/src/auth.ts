import { load } from "cheerio";
import { readApi } from "./client";
import { AuthenticationError } from "./errors";
import type { MeuhedetSession } from "./session";
import { LOGIN_ORIGIN, MeuhedetTransport, PORTAL_ORIGIN, checkedUrl, readCapped, type TransportOptions } from "./transport";

export interface LoginChallenge { id: string; step: "otp"; }
interface Form {
  action: URL;
  fields: URLSearchParams;
  editable: string[];
  codeFields: string[];
  method: string;
  unnamedDigitCount: number;
  recognizedDigitCount: number;
  hiddenCodeFieldCount: number;
}
const codeName = /otp|code|verification|secure/i;
function parseForms(html: string, pageUrl: string): Form[] {
  const $ = load(html);
  return $("form").toArray().map(element => {
    const form = $(element);
    const action = checkedUrl(new URL(form.attr("action") || pageUrl, pageUrl));
    const fields = new URLSearchParams();
    const editable: string[] = [];
    let unnamedDigitCount = 0;
    // Unnamed OTP boxes do not contribute POST fields. A raw response may
    // contain a single labeled digit control before any client-side rendering.
    // In either supported shape, the named submission field must still be
    // supplied by this exact response; no endpoint or field is invented.
    const digits = form.find("input").toArray().flatMap(input => {
      const field = $(input);
      const type = (field.attr("type") ?? "text").toLowerCase();
      if (field.attr("name") || !["text", "tel", "number"].includes(type) ||
          field.attr("autocomplete") !== "one-time-code") return [];
      unnamedDigitCount++;
      const label = field.attr("aria-label") ?? "";
      const match = /^קוד חד פעמי, ספרה מספר ([1-6])$/.exec(label);
      return match ? [Number(match[1])] : [];
    });
    const sixDigitOtp = unnamedDigitCount === 6 && digits.length === 6 && new Set(digits).size === 6;
    const singleLabeledDigit = unnamedDigitCount === 1 && digits.length === 1;
    const hiddenOtpEvidence = sixDigitOtp || singleLabeledDigit;
    const codeFields: string[] = [];
    let hiddenCodeFieldCount = 0;
    form.find("input[name],select[name]").each((_, input) => {
      const field = $(input);
      const name = field.attr("name") ?? "";
      const type = (field.attr("type") ?? "text").toLowerCase();
      if (!name || field.is(":disabled") || ["button", "submit", "file", "image"].includes(type)) return;
      if (["checkbox", "radio"].includes(type) && !field.is(":checked")) return;
      fields.append(name, field.is("select") ? field.find("option:selected").val()?.toString() ?? "" : field.val()?.toString() ?? "");
      if (!["hidden", "checkbox", "radio"].includes(type)) editable.push(name);
      if (name.toLowerCase() !== "__requestverificationtoken" && codeName.test(name)) {
        if (type === "hidden" && !field.val()) hiddenCodeFieldCount++;
        if (type !== "hidden" || hiddenOtpEvidence && !field.val()) codeFields.push(name);
      }
    });
    return { action, fields, editable, codeFields, method: (form.attr("method") || "get").toLowerCase(), unnamedDigitCount, recognizedDigitCount: digits.length, hiddenCodeFieldCount };
  });
}
/** Only an explicitly initiated sign-in may send personal identifiers or a one-time code. */
export class MeuhedetAuth {
  readonly transport: MeuhedetTransport;
  #challenge?: { id: string; form: Form; codeField: string; expiresAt: number };
  #busy = false;
  constructor(options: TransportOptions = {}) { this.transport = new MeuhedetTransport(options); }

  async beginLogin(credentials: { username: string; mobilePhoneNumber: string }): Promise<LoginChallenge> {
    if (this.#busy || this.#challenge) throw new AuthenticationError("LOGIN_ALREADY_STARTED");
    if (!/^\d{5,9}$/.test(credentials.username) || !/^05\d{8}$/.test(credentials.mobilePhoneNumber))
      throw new AuthenticationError("INVALID_LOGIN_DETAILS");
    this.#busy = true;
    try {
      await this.transport.clearSession();
      const page = await this.transport.request(PORTAL_ORIGIN + "/");
      if (!page.ok || !page.headers.get("content-type")?.includes("text/html")) throw new AuthenticationError("LOGIN_PAGE_CHANGED", page.status);
      let pageUrl = page.url || LOGIN_ORIGIN + "/Account/Login";
      let html = await readCapped(page);
      // The observed Account/Login page links to FirstStepLogin instead of embedding its form.
      // Only follow that exact same-origin link; never send identifiers to an unverified action.
      if (!parseForms(html, pageUrl).some(candidate => candidate.action.pathname.toLowerCase() === "/account/firststeplogin")) {
        const $ = load(html);
        const links = $("a[href]").toArray().flatMap(element => {
          try { const url = new URL($(element).attr("href")!, pageUrl);
            return url.origin === LOGIN_ORIGIN && url.pathname.toLowerCase() === "/account/firststeplogin" ? [url] : [];
          } catch { return []; }
        });
        if (links.length !== 1) throw new AuthenticationError("LOGIN_PAGE_CHANGED");
        const firstStep = await this.transport.request(links[0]);
        if (!firstStep.ok || !firstStep.headers.get("content-type")?.includes("text/html")) throw new AuthenticationError("LOGIN_PAGE_CHANGED", firstStep.status);
        pageUrl = firstStep.url || links[0].href;
        html = await readCapped(firstStep);
      }
      const form = parseForms(html, pageUrl).find(candidate =>
        candidate.action.origin === LOGIN_ORIGIN && candidate.action.pathname.toLowerCase() === "/account/firststeplogin" &&
        candidate.method === "post" &&
        ["Username", "MobilePhoneNumber", "ReturnUrl", "__RequestVerificationToken"].every(field => candidate.fields.has(field)));
      if (!form) throw new AuthenticationError("LOGIN_PAGE_CHANGED");
      form.fields.set("Username", credentials.username);
      form.fields.set("MobilePhoneNumber", credentials.mobilePhoneNumber);
      const response = await this.transport.request(form.action, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: LOGIN_ORIGIN },
        body: form.fields,
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new AuthenticationError("AUTH_RESPONSE_CHANGED", response.status);
      const nextHtml = await readCapped(response);
      const nextForms = parseForms(nextHtml, response.url || LOGIN_ORIGIN + "/Account/FirstStepLogin");
      // Match only a field supplied in this response, never a guessed OTP endpoint or field name.
      const candidates = nextForms.flatMap(candidate => candidate.codeFields
        .map(codeField => ({ form: candidate, codeField })))
        .filter(candidate => candidate.form.action.origin === LOGIN_ORIGIN && candidate.form.method === "post" && candidate.form.fields.has("__RequestVerificationToken"));
      if (candidates.length !== 1) {
        const $ = load(nextHtml);
        const loginFormReturned = nextForms.some(f => f.action.origin === LOGIN_ORIGIN && f.action.pathname.toLowerCase() === "/account/firststeplogin");
        throw new AuthenticationError(candidates.length === 0 && loginFormReturned ? "LOGIN_NOT_ADVANCED" : "OTP_FORM_UNVERIFIED", response.status, {
          formCount: nextForms.length, postFormCount: nextForms.filter(f => f.method === "post").length,
          csrfPostFormCount: nextForms.filter(f => f.method === "post" && f.fields.has("__RequestVerificationToken")).length,
          codeFieldCount: nextForms.reduce((count, f) => count + f.codeFields.length, 0),
          hiddenCodeFieldCount: nextForms.reduce((count, f) => count + f.hiddenCodeFieldCount, 0),
          unnamedDigitCount: nextForms.reduce((count, f) => count + f.unnamedDigitCount, 0),
          recognizedDigitCount: nextForms.reduce((count, f) => count + f.recognizedDigitCount, 0), candidateCount: candidates.length,
          loginFormReturned, validationErrorPresent: $(".validation-summary-errors,.field-validation-error").length > 0,
        });
      }
      const id = crypto.randomUUID();
      this.#challenge = { id, ...candidates[0], expiresAt: Date.now() + 10 * 60_000 };
      return { id, step: "otp" };
    } catch (error) {
      await this.transport.clearSession();
      throw error;
    } finally { this.#busy = false; }
  }

  async completeLogin(challengeId: string, code: string): Promise<MeuhedetSession> {
    const challenge = this.#challenge;
    if (!challenge || challenge.id !== challengeId) throw new AuthenticationError("UNKNOWN_LOGIN_CHALLENGE");
    if (Date.now() >= challenge.expiresAt) { this.#challenge = undefined; throw new AuthenticationError("LOGIN_CHALLENGE_EXPIRED"); }
    if (this.#busy) throw new AuthenticationError("LOGIN_STEP_IN_PROGRESS");
    if (!/^\d{4,8}$/.test(code)) throw new AuthenticationError("INVALID_OTP_FORMAT");
    this.#busy = true;
    try {
      challenge.form.fields.set(challenge.codeField, code);
      const response = await this.transport.request(challenge.form.action, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: LOGIN_ORIGIN },
        body: challenge.form.fields,
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new AuthenticationError("AUTH_RESPONSE_CHANGED", response.status);
      const html = await readCapped(response);
      const forms = parseForms(html, response.url || LOGIN_ORIGIN + "/");
      if (forms.some(form => form.action.origin === LOGIN_ORIGIN && form.codeFields.length))
        throw new AuthenticationError("OTP_REJECTED");
      const oidc = forms.find(form => form.action.href === PORTAL_ORIGIN + "/signin-oidc" && form.method === "post" && form.fields.has("id_token") && form.fields.has("state"));
      if (!oidc) throw new AuthenticationError("PORTAL_SESSION_UNCONFIRMED");
      const callback = await this.transport.request(oidc.action, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: LOGIN_ORIGIN },
        body: oidc.fields,
      });
      await callback.body?.cancel().catch(() => undefined);
      if (!callback.ok || !callback.url.startsWith(PORTAL_ORIGIN + "/")) throw new AuthenticationError("PORTAL_SESSION_UNCONFIRMED");
      // Verify an authenticated account without loading laboratory records.
      this.transport.markAuthenticated();
      try { await readApi(this.transport, "AppointmentApi/FutureAppointmentsOnly", true); }
      catch { throw new AuthenticationError("PORTAL_SESSION_UNCONFIRMED"); }
      this.#challenge = undefined;
      return this.transport.exportSession();
    } catch (error) {
      await this.transport.clearSession();
      this.#challenge = undefined;
      throw error;
    } finally { this.#busy = false; }
  }
  async cancelLogin(): Promise<void> {
    if (this.#busy) throw new AuthenticationError("LOGIN_STEP_IN_PROGRESS");
    this.#challenge = undefined;
    await this.transport.clearSession();
  }
}
