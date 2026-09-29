import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MeuhedetError, type MeuhedetSession } from "@meuhedet/core";
import { SessionStoreError } from "./store";
import { loginPage } from "./login-page";

interface Auth {
  beginLogin(details: { username: string; mobilePhoneNumber: string }): Promise<{ id: string }>;
  completeLogin(id: string, code: string): Promise<MeuhedetSession>;
  cancelLogin(): Promise<void>;
}
export type LoginState = "credentials" | "otp" | "working" | "complete" | "failed" | "cancelled" | "expired";
export class BrowserLoginError extends Error {
  constructor(readonly code: string) { super("Local sign-in did not complete. Start a new login --browser flow."); }
}
export async function startBrowserLogin(options: {
  auth: Auth;
  save(session: MeuhedetSession): Promise<void>;
  timeoutMs?: number;
}) {
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(18).toString("base64");
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  let state: LoginState = "credentials";
  let challengeId = "";
  let finished = false;
  let origin = "";
  let closePromise: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  let settle!: (error?: BrowserLoginError) => void;
  const completion = new Promise<BrowserLoginError | undefined>(resolve => { settle = resolve; });
  const finish = (next: LoginState, code?: string) => {
    if (finished) return;
    finished = true;
    state = next;
    challengeId = "";
    clearTimeout(timer);
    settle(code ? new BrowserLoginError(code) : undefined);
  };
  const respond = (res: ServerResponse, status: number, value: object) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  };
  const server = createServer((req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("content-security-policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`);
    void handle(req, res).catch(error => {
      const code = error instanceof MeuhedetError || error instanceof SessionStoreError ? error.code : "BROWSER_LOGIN_FAILED";
      respond(res, 500, { state: "failed", message: "Sign-in failed. Your agent can check the sign-in error." });
      finish("failed", code);
    });
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    // An exact Host check prevents DNS rebinding; the capability and Origin bind submissions to this flow.
    if (req.headers.host !== new URL(origin).host) { respond(res, 403, {}); return; }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(loginPage(nonce));
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}` ||
      req.method !== "GET" && req.headers.origin !== origin) { respond(res, 403, {}); return; }
    if (req.method === "GET" && req.url === "/state") { respond(res, 200, { state }); return; }
    if (req.method !== "POST" || !["/credentials", "/otp", "/cancel"].includes(req.url ?? "")) {
      respond(res, 404, {}); return;
    }
    if (finished || state === "working") { respond(res, 409, { state }); return; }
    if (req.url === "/cancel") {
      respond(res, 200, { state: "cancelled" });
      finish("cancelled", "BROWSER_LOGIN_CANCELLED");
      return;
    }
    let fields: Record<string, unknown>;
    try {
      if (req.headers["content-type"] !== "application/json") throw new Error();
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 2048) throw new Error();
      }
      fields = JSON.parse(body);
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error();
    } catch { respond(res, 400, { state, message: "Please check the form and try again." }); return; }
    if (req.url === "/credentials") {
      if (state !== "credentials") { respond(res, 409, { state }); return; }
      const { username, mobilePhoneNumber } = fields;
      if (Object.keys(fields).length !== 2 || typeof username !== "string" || !/^\d{5,9}$/.test(username) ||
        typeof mobilePhoneNumber !== "string" || !/^05\d{8}$/.test(mobilePhoneNumber)) {
        respond(res, 400, { state, message: "Enter a valid ID and Israeli mobile number." }); return;
      }
      state = "working";
      const challenge = await options.auth.beginLogin({ username, mobilePhoneNumber });
      if (finished) { respond(res, 410, { state }); return; }
      challengeId = challenge.id;
      state = "otp";
      respond(res, 200, { state });
      return;
    }
    if (state !== "otp") { respond(res, 409, { state }); return; }
    if (Object.keys(fields).length !== 1 || typeof fields.code !== "string" || !/^\d{4,8}$/.test(fields.code)) {
      respond(res, 400, { state, message: "Enter the SMS code you received." }); return;
    }
    state = "working";
    const session = await options.auth.completeLogin(challengeId, fields.code);
    if (finished) { respond(res, 410, { state }); return; }
    clearTimeout(timer);
    await options.save(session);
    respond(res, 200, { state: "complete" });
    finish("complete");
  }
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new BrowserLoginError("BROWSER_LOGIN_UNAVAILABLE");
  origin = `http://127.0.0.1:${address.port}`;
  const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
  timer = setTimeout(() => finish("expired", "BROWSER_LOGIN_EXPIRED"), timeoutMs);
  return {
    url: `${origin}/#${token}`,
    expiresAt,
    completion,
    close(): Promise<void> {
      closePromise ??= (async () => {
        finish("cancelled", "BROWSER_LOGIN_CANCELLED");
        if (state !== "complete") server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await options.auth.cancelLogin().catch(() => undefined);
      })();
      return closePromise;
    },
  };
}
