import { CookieJar, type SerializedCookieJar } from "tough-cookie";
import { MeuhedetError, ReauthenticationRequired, UpstreamError } from "./errors";
import type { MeuhedetSession } from "./session";

export const PORTAL_ORIGIN = "https://online.meuhedet.co.il";
export const LOGIN_ORIGIN = "https://login.meuhedet.co.il";
const origins = new Set([PORTAL_ORIGIN, LOGIN_ORIGIN]);
const redirects = new Set([301, 302, 303, 307, 308]);
export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface TransportOptions {
  fetch?: FetchFunction;
  session?: MeuhedetSession;
  timeoutMs?: number;
  now?: () => number;
}
export async function readCapped(response: Response, maxBytes = 2_000_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new UpstreamError("RESPONSE_READ_TIMEOUT")), 30_000);
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new UpstreamError("RESPONSE_TOO_LARGE");
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError("RESPONSE_READ_FAILED");
  } finally {
    clearTimeout(timeoutId);
    // Abort a stalled stream without delaying the caller if the source ignores cancellation.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}
export function checkedUrl(input: string | URL): URL {
  let url: URL;
  try { url = new URL(input, PORTAL_ORIGIN); }
  catch { throw new UpstreamError("INVALID_URL"); }
  if (!origins.has(url.origin) || url.username || url.password) throw new UpstreamError("UNSUPPORTED_ORIGIN");
  return url;
}
function allowedCookies(cookies: SerializedCookieJar): boolean {
  return Array.isArray(cookies.cookies) && cookies.cookies.every(cookie => {
    const domain = typeof cookie.domain === "string" ? cookie.domain.replace(/^\./, "").toLowerCase() : "";
    return ["online.meuhedet.co.il", "login.meuhedet.co.il", "meuhedet.co.il"].includes(domain);
  });
}
export class MeuhedetTransport {
  readonly #fetch: FetchFunction;
  #jar: CookieJar;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  #authenticatedAt?: string;
  constructor(options: TransportOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#now = options.now ?? Date.now;
    if (options.session && (typeof options.session !== "object" || Array.isArray(options.session)))
      throw new UpstreamError("INVALID_SESSION");
    if (options.session && !("version" in options.session) && (options.session as { session?: unknown }).session)
      throw new MeuhedetError("SESSION_NOT_UNWRAPPED", "Pass the inner session value.");
    if (options.session && (options.session.provider !== "meuhedet" || options.session.version !== 1 ||
      typeof options.session.authenticatedAt !== "string" || !Number.isFinite(Date.parse(options.session.authenticatedAt))))
      throw new UpstreamError("INVALID_SESSION");
    try {
      this.#jar = options.session ? CookieJar.deserializeSync(options.session.cookies) : new CookieJar();
      if (options.session && !allowedCookies(options.session.cookies)) throw new Error();
    } catch { throw new UpstreamError("INVALID_SESSION"); }
    this.#authenticatedAt = options.session?.authenticatedAt;
  }
  markAuthenticated(): void { this.#authenticatedAt = new Date(this.#now()).toISOString(); }
  get hasSession(): boolean { return Boolean(this.#authenticatedAt); }
  async exportSession(): Promise<MeuhedetSession> {
    if (!this.#authenticatedAt) throw new ReauthenticationRequired();
    return { provider: "meuhedet", version: 1, cookies: await this.#jar.serialize(), authenticatedAt: this.#authenticatedAt };
  }
  async exportCookies(): Promise<SerializedCookieJar> { return this.#jar.serialize(); }
  importCookies(cookies: SerializedCookieJar): void {
    try {
      if (!allowedCookies(cookies)) throw new Error();
      this.#jar = CookieJar.deserializeSync(cookies);
    }
    catch { throw new UpstreamError("INVALID_SESSION"); }
  }
  async clearSession(): Promise<void> { await this.#jar.removeAllCookies(); this.#authenticatedAt = undefined; }
  async request(input: string | URL, init: RequestInit = {}): Promise<Response> {
    let url = checkedUrl(input);
    let method = (init.method ?? "GET").toUpperCase();
    let body = init.body;
    const headers = new Headers(init.headers); headers.delete("cookie");
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    for (let hop = 0; hop <= 8; hop++) {
      const protectedRequest = Boolean(this.#authenticatedAt) && url.origin === PORTAL_ORIGIN;
      const outbound = new Headers(headers);
      const cookies = await this.#jar.getCookieString(url.href);
      if (cookies) outbound.set("cookie", cookies);
      let response: Response;
      try {
        const attempt = this.#fetch(url.href, { ...init, method, body, headers: outbound, redirect: "manual", signal });
        response = await Promise.race([attempt, new Promise<never>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        })]);
      } catch {
        throw new UpstreamError(timeout.aborted ? "REQUEST_TIMEOUT" : signal.aborted ? "REQUEST_ABORTED" : "NETWORK_ERROR");
      }
      try {
        for (const cookie of response.headers.getSetCookie()) await this.#jar.setCookie(cookie, url.href);
      } catch {
        await response.body?.cancel().catch(() => undefined);
        throw new UpstreamError("INVALID_UPSTREAM_COOKIE");
      }
      const location = response.headers.get("location");
      if (protectedRequest && (response.status === 401 || response.status === 403)) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 401) { await this.clearSession(); throw new ReauthenticationRequired(401); }
        throw new UpstreamError("HTTP_ERROR", 403);
      }
      if (!redirects.has(response.status) || !location) return response;
      let next: URL;
      try { next = checkedUrl(new URL(location, url)); }
      catch (error) { await response.body?.cancel().catch(() => undefined); throw error; }
      if (protectedRequest && next.origin === LOGIN_ORIGIN) {
        await response.body?.cancel().catch(() => undefined);
        await this.clearSession(); throw new ReauthenticationRequired(response.status);
      }
      if (init.redirect === "manual") return response;
      if (init.redirect === "error") {
        await response.body?.cancel().catch(() => undefined);
        throw new UpstreamError("UNEXPECTED_REDIRECT", response.status);
      }
      // 307/308 preserve a POST body. An OTP or form token must never follow a
      // redirect onto another origin, even one on this transport's allowlist.
      if (next.origin !== url.origin && body && [307, 308].includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new UpstreamError("CROSS_ORIGIN_POST_REDIRECT", response.status);
      }
      if (next.origin !== url.origin) {
        headers.delete("authorization"); headers.delete("origin"); headers.delete("referer");
      }
      if (response.status === 303 && method !== "HEAD" || [301, 302].includes(response.status) && method === "POST") {
        method = "GET"; body = undefined;
        headers.delete("content-type"); headers.delete("content-length");
      }
      await response.body?.cancel().catch(() => undefined);
      url = next;
    }
    throw new UpstreamError("TOO_MANY_REDIRECTS");
  }
}
