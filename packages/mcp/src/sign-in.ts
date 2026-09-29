import { randomUUID } from "node:crypto";
import type { McpServer, CallToolResult } from "@modelcontextprotocol/server";
import { MeuhedetAuth, MeuhedetError, type MeuhedetSession } from "@meuhedet/core";
import { configDirectory, FileSessionStore, type SessionStore } from "@meuhedet/cli/store";
import { join } from "node:path";
import * as z from "zod/v4";
import { signInComponent } from "./sign-in-component";

const RESOURCE = "ui://meuhedet/sign-in-v1.html";
const LIFETIME_MS = 10 * 60_000;
const loginDetails = z.object({ username: z.string().regex(/^\d{5,9}$/), mobilePhoneNumber: z.string().regex(/^05\d{8}$/) }).strict();
export type LoginDetails = z.infer<typeof loginDetails>;
type State = "credentials" | "otp" | "working" | "complete" | "cancelled" | "expired" | "failed";
export interface SignInAuth {
  beginLogin(details: { username: string; mobilePhoneNumber: string }): Promise<{ id: string }>;
  completeLogin(id: string, code: string): Promise<MeuhedetSession>;
  cancelLogin(): Promise<void>;
}
export function registerSignIn(server: McpServer, options: {
  store: SessionStore<MeuhedetSession>;
  profileStore?: SessionStore<LoginDetails>;
  createAuth?: () => SignInAuth;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const profileStore = options.profileStore ?? new FileSessionStore<LoginDetails>(join(configDirectory(), "sign-in-profile.json"));
  let flow: { id: string; state: State; expiresAt: number; auth: SignInAuth; challengeId?: string; details?: LoginDetails; savedDetails?: LoginDetails } | undefined;
  function result(state: State, code?: string): CallToolResult {
    const value = { state, ...(code ? { error: { code } } : {}) };
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
      ...(flow && ["credentials", "otp", "working"].includes(state) ? { _meta: { flowId: flow.id, hasSavedDetails: !!flow.savedDetails } } : {}),
      ...(code ? { isError: true } : {}),
    };
  }
  async function expire() {
    if (flow && now() >= flow.expiresAt && ["credentials", "otp", "working"].includes(flow.state)) {
      flow.state = "expired";
      flow.challengeId = undefined;
      flow.details = undefined;
      flow.savedDetails = undefined;
      await flow.auth.cancelLogin().catch(() => undefined);
    }
  }
  server.registerResource("meuhedet-sign-in", RESOURCE, { mimeType: "text/html;profile=mcp-app" }, async () => ({
    contents: [{ uri: RESOURCE, mimeType: "text/html;profile=mcp-app", text: signInComponent,
      _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }],
  }));
  server.registerTool("meuhedet_sign_in", {
    description: "Show the private Meuhedet sign-in form inside the chat. The user enters their ID, phone and SMS code in the component, never in a model tool call. Reuse a saved session when present.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: RESOURCE }, "openai/outputTemplate": RESOURCE },
  }, async () => {
    try {
      await expire();
      if (flow?.state === "working") return result("working");
      if (await options.store.load()) return result("complete");
      if (flow && ["credentials", "otp"].includes(flow.state)) return result(flow.state);
      flow = { id: randomUUID(), state: "credentials", expiresAt: now() + LIFETIME_MS, auth: options.createAuth?.() ?? new MeuhedetAuth() };
      const saved = await profileStore.load();
      if (saved) flow.savedDetails = loginDetails.parse(saved);
      return result(flow.state);
    } catch { return result("failed", "SIGN_IN_UNAVAILABLE"); }
  });
  server.registerTool("meuhedet_sign_in_action", {
    description: "Private sign-in component action. Available only to the app; never supply credentials from the model.",
    inputSchema: z.object({
      flowId: z.string().uuid(), action: z.enum(["credentials", "saved", "forget", "otp", "state", "cancel"]),
      username: z.string().regex(/^\d{5,9}$/).optional(),
      mobilePhoneNumber: z.string().regex(/^05\d{8}$/).optional(),
      code: z.string().regex(/^\d{4,8}$/).optional(),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ flowId, action, username, mobilePhoneNumber, code }) => {
    await expire();
    if (!flow || flow.id !== flowId) return result("failed", "SIGN_IN_FLOW_UNAVAILABLE");
    const current = flow;
    if (action === "state") return result(current.state);
    if (["complete", "cancelled", "expired", "failed"].includes(current.state)) return result(current.state);
    if (current.state === "working") return result("working", "SIGN_IN_IN_PROGRESS");
    if (action === "forget") {
      if (current.state !== "credentials" || username || mobilePhoneNumber || code) return result(current.state, "INVALID_SIGN_IN_STEP");
      try {
        await profileStore.delete();
        current.savedDetails = undefined;
        return result(current.state);
      } catch { return result(current.state, "PROFILE_STORE_UNAVAILABLE"); }
    }
    if (action === "cancel") {
      current.state = "cancelled";
      current.challengeId = undefined;
      current.details = undefined;
      current.savedDetails = undefined;
      await current.auth.cancelLogin().catch(() => undefined);
      return result(current.state);
    }
    const valid = action === "saved" ? current.state === "credentials" && current.savedDetails && !username && !mobilePhoneNumber && !code
      : action === "credentials" ? current.state === "credentials" && username && mobilePhoneNumber && !code
      : current.state === "otp" && code && !username && !mobilePhoneNumber;
    if (!valid) return result(current.state, "INVALID_SIGN_IN_STEP");
    current.state = "working";
    try {
      if (action === "credentials" || action === "saved") {
        const details = action === "saved" ? current.savedDetails! : { username: username!, mobilePhoneNumber: mobilePhoneNumber! };
        const challenge = await current.auth.beginLogin(details);
        await expire();
        if (current.state !== "working") return result(current.state);
        current.challengeId = challenge.id;
        current.details = details;
        current.state = "otp";
      } else {
        const session = await current.auth.completeLogin(current.challengeId!, code!);
        await expire();
        if (current.state !== "working") return result(current.state);
        await profileStore.save(current.details!);
        await options.store.save(session);
        current.challengeId = undefined;
        current.details = undefined;
        current.savedDetails = undefined;
        current.state = "complete";
      }
      return result(current.state);
    } catch (error) {
      current.state = "failed";
      current.challengeId = undefined;
      current.details = undefined;
      current.savedDetails = undefined;
      await current.auth.cancelLogin().catch(() => undefined);
      return result("failed", error instanceof MeuhedetError ? error.code : "SIGN_IN_FAILED");
    }
  });
}
