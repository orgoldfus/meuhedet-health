import { McpServer, createRequestStateCodec, type CallToolResult } from "@modelcontextprotocol/server";
import { randomBytes } from "node:crypto";
import * as z from "zod/v4";
import { MeuhedetClient, MeuhedetError, ReauthenticationRequired, safeClinical, type MeuhedetSession } from "@meuhedet/core";
import { FileSessionStore, type SessionStore } from "@meuhedet/cli/store";
import { registerSignIn, type SignInAuth, type LoginDetails } from "./sign-in";
import { registerAppointmentTools, type AppointmentToolsOptions } from "./appointment-tools";

export interface ReaderOperations {
  labStickers(): Promise<unknown>;
  labStickersRange(fromDate: string, toDate: string): Promise<unknown>;
  labSticker(labCode: string, stickerId: string, date: string): Promise<unknown>;
  prescriptions(): Promise<unknown>;
  activeMedicines(): Promise<unknown>;
  medicineApprovals(): Promise<unknown>;
  purchasedMedicines(): Promise<unknown>;
  prescriptionHistory(): Promise<unknown>;
  futureAppointments(): Promise<unknown>;
  visitApprovals(): Promise<unknown>;
  visitReferrals(): Promise<unknown>;
  exportSession(): MeuhedetSession | Promise<MeuhedetSession>;
}
export interface McpOptions {
  store?: SessionStore<MeuhedetSession>;
  profileStore?: SessionStore<LoginDetails>;
  connect?: (session: MeuhedetSession) => ReaderOperations;
  createAuth?: () => SignInAuth;
  now?: () => number;
  directory?: AppointmentToolsOptions["directory"];
  appointments?: AppointmentToolsOptions["appointments"];
  bookingJournal?: AppointmentToolsOptions["bookingJournal"];
  allowBooking?: boolean;
}
const MAX_JSON_BYTES = 128 * 1024;
function calendarDate(value: string, compact = false): boolean {
  const match = (compact ? /^(\d{4})(\d{2})(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/).exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
const isoDate = z.string().refine(value => calendarDate(value), "Expected a valid YYYY-MM-DD date");
const detailDate = z.string().refine(value => calendarDate(value, true), "Expected a valid YYYYMMDD date");
const numericId = z.string().regex(/^\d+$/, "Expected a numeric identifier");
function result(value: unknown): CallToolResult {
  const safe = safeClinical(value);
  const json = JSON.stringify(safe);
  if (Buffer.byteLength(json) > MAX_JSON_BYTES) return failure("OUTPUT_TOO_LARGE", "The result is too large for this tool.");
  return { content: [{ type: "text", text: json }], structuredContent: typeof safe === "object" && safe !== null && !Array.isArray(safe) ? safe as Record<string, unknown> : { data: safe } };
}
function failure(code: string, instruction: string): CallToolResult {
  const value = { error: { code, instruction } };
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: true };
}

/** Credentials are accepted only through app-only sign-in tools, never model-visible readers. */
export function createMeuhedetMcpServer(options: McpOptions = {}): McpServer {
  const store = options.store ?? new FileSessionStore<MeuhedetSession>();
  const connect = options.connect ?? ((session: MeuhedetSession) => new MeuhedetClient({ session }));
  const approvalState = createRequestStateCodec<{ proposalId: string; nonce: string }>({
    key: randomBytes(32), ttlSeconds: 300, bind: ctx => `${ctx.mcpReq.method}:${ctx.sessionId ?? "stdio"}`,
  });
  const server = new McpServer({ name: "meuhedet-health", version: "0.1.0" }, {
    requestState: { verify: approvalState.verify },
    instructions: "Meuhedet account reads and public doctor search. Booking requires an exact reviewed proposal, explicit user intent and host-mediated confirmation; execution is disabled by default. Never book during read-only or development tasks. Use meuhedet_sign_in for in-chat authentication when supported; login --browser is the fallback. Never call the app-only sign-in action from the model. Preserve Hebrew text, dates and units. Do not assume absence of care from a missing row. Do not send credentials in tool arguments.",
  });
  let tail: Promise<unknown> = Promise.resolve();
  function serialize<T>(execute: () => Promise<T>): Promise<T> {
    const task = tail.then(execute, execute);
    tail = task.then(() => undefined, () => undefined);
    return task;
  }
  registerSignIn(server, { store: {
    load: () => serialize(() => store.load()), save: session => serialize(() => store.save(session)), delete: () => serialize(() => store.delete()),
  }, profileStore: options.profileStore, createAuth: options.createAuth, now: options.now });
  registerAppointmentTools(server, { store, serialize, directory: options.directory, appointments: options.appointments,
    bookingJournal: options.bookingJournal, allowBooking: options.allowBooking, now: options.now,
    mintApproval: (proposalId, nonce, ctx) => approvalState.mint({ proposalId, nonce }, ctx) });
  server.registerTool("meuhedet_session_status", {
    description: "Check only whether a local session file exists. This does not verify validity with Meuhedet.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try { return result({ sessionSaved: (await store.load()) !== null, upstreamValidity: "unverified" }); }
    catch { return failure("SESSION_STORE_UNAVAILABLE", "The local session file could not be read."); }
  });
  async function read(operation: (client: ReaderOperations) => Promise<unknown>): Promise<CallToolResult> {
    const execute = async (): Promise<CallToolResult> => {
      try {
        const session = await store.load();
        if (!session) return failure("NOT_AUTHENTICATED", "Call meuhedet_sign_in for a native form, or use login --browser if the host cannot render MCP Apps.");
        const client = connect(session);
        const data = await operation(client);
        await store.save(await client.exportSession());
        return result(data);
      } catch (error) {
        // An upstream failure may contain cookies, HTML, or clinical content. Do not serialize it.
        if (error instanceof ReauthenticationRequired) {
          await store.delete().catch(() => undefined);
          return failure(error.code, "The saved session expired and was removed. Start meuhedet-health login --browser for a fresh sign-in.");
        }
        if (error instanceof MeuhedetError) return failure(error.code, "The Meuhedet read failed. Check the session and retry.");
        return failure("READ_FAILED", "The read failed. Check the session with meuhedet-health status and retry.");
      }
    };
    return serialize(execute);
  }
  server.registerTool("meuhedet_prescriptions", {
    description: "Read the current account prescription summary. The portal's retention and completeness are unverified.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, () => read(client => client.prescriptions()));
  for (const [name, description, operation] of [
    ["meuhedet_active_medicines", "Read active medicines.", (client: ReaderOperations) => client.activeMedicines()],
    ["meuhedet_medicine_approvals", "Read medicine approvals.", (client: ReaderOperations) => client.medicineApprovals()],
    ["meuhedet_purchased_medicines", "Read purchased medicines.", (client: ReaderOperations) => client.purchasedMedicines()],
    ["meuhedet_prescription_history", "Read prescription history.", (client: ReaderOperations) => client.prescriptionHistory()],
  ] as const) {
    server.registerTool(name, {
      description: `${description} Portal retention and completeness are unverified.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, () => read(operation));
  }
  server.registerTool("meuhedet_lab_stickers", {
    description: "Read dashboard lab stickers. This is a summary, not a complete lab history.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, () => read(client => client.labStickers()));
  server.registerTool("meuhedet_lab_results", {
    description: "Read lab stickers in a YYYY-MM-DD date window. Boundary inclusion, retention and completeness are unverified.",
    inputSchema: z.object({ fromDate: isoDate, toDate: isoDate }).strict().refine(value => value.fromDate <= value.toDate, "The fromDate must not follow toDate"),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, ({ fromDate, toDate }) => read(client => client.labStickersRange(fromDate, toDate)));
  server.registerTool("meuhedet_lab_result", {
    description: "Read one lab sticker detail by numeric lab code, numeric sticker ID and YYYYMMDD date from a sticker listing.",
    inputSchema: z.object({ labCode: numericId, stickerId: numericId, date: detailDate }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, ({ labCode, stickerId, date }) => read(client => client.labSticker(labCode, stickerId, date)));
  server.registerTool("meuhedet_future_appointments", {
    description: "Read future appointments for the current account. An empty response does not prove complete history.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, () => read(client => client.futureAppointments()));
  server.registerTool("meuhedet_visit_approvals", {
    description: "Read online visit approvals for the current account. Portal retention and completeness are unverified.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, () => read(client => client.visitApprovals()));
  server.registerTool("meuhedet_visit_referrals", {
    description: "Read online visit referrals for the current account. Portal retention and completeness are unverified.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, () => read(client => client.visitReferrals()));
  return server;
}
