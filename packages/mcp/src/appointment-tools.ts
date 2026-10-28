import { createHash, randomUUID } from "node:crypto";
import { acceptedContent, inputRequired, inputResponse, type McpServer, type ServerContext, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { MeuhedetAppointmentClient, MeuhedetDirectory, MeuhedetError, UpstreamError, ReauthenticationRequired,
  type MeuhedetSession, type AppointmentChoice, type PreparedAppointment } from "@meuhedet/core";
import type { SessionStore } from "@meuhedet/cli/store";
import { FileBookingJournal, type BookingJournal } from "./booking-journal";

const id = z.string().regex(/^2_[A-Za-z0-9_-]{1,150}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const proposalSchema = z.object({ proposalId: z.uuid() }).strict();
const approvalSchema = z.object({ approve: z.boolean() }).strict();
const keySchema = z.object({ bookingKey: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const output = (value: Record<string, unknown>): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
const failure = (code: string): CallToolResult => ({ ...output({ error: { code } }), isError: true });
interface Proposal { prepared: PreparedAppointment; loginMarker: string; expiresAt: number; bookingKey: string; confirmation?: string; }
export interface AppointmentToolsOptions {
  store: SessionStore<MeuhedetSession>;
  serialize<T>(work: () => Promise<T>): Promise<T>;
  directory?: Pick<MeuhedetDirectory, "searchDoctors">;
  appointments?: (session: MeuhedetSession) => Pick<MeuhedetAppointmentClient, "availability" | "prepare" | "submit" | "exportSession">;
  bookingJournal?: BookingJournal;
  allowBooking?: boolean;
  now?: () => number;
  mintApproval(proposalId: string, nonce: string, ctx: ServerContext): Promise<string>;
}

export function registerAppointmentTools(server: McpServer, options: AppointmentToolsOptions) {
  const directory = options.directory ?? new MeuhedetDirectory();
  const allowBooking = options.allowBooking ?? process.env.MEUHEDET_ENABLE_BOOKING === "1";
  const appointments = options.appointments ?? (session => new MeuhedetAppointmentClient({ session, allowBooking }));
  const journal = options.bookingJournal ?? new FileBookingJournal();
  const now = options.now ?? Date.now;
  const proposals = new Map<string, Proposal>();
  const readonly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  async function safe(work: () => Promise<CallToolResult>) {
    try { return await work(); }
    catch (error) {
      if (error instanceof ReauthenticationRequired) proposals.clear();
      return failure(error instanceof MeuhedetError ? error.code : "APPOINTMENT_OPERATION_FAILED");
    }
  }
  async function connected() {
    const session = await options.store.load();
    if (!session) throw new ReauthenticationRequired();
    return { session, client: appointments(session) };
  }
  function getProposal(proposalId: string): Proposal {
    const proposal = proposals.get(proposalId);
    if (!proposal) throw new UpstreamError("BOOKING_PROPOSAL_UNKNOWN");
    if (now() >= proposal.expiresAt) { proposals.delete(proposalId); throw new UpstreamError("BOOKING_PROPOSAL_EXPIRED"); }
    return proposal;
  }
  function review(proposal: Proposal) {
    const p = proposal.prepared, body = p.body.New;
    return { doctor: p.doctor, date: p.choice.date, startTime: body.StartTime, endTime: body.EndTime,
      appointmentType: "clinic", timezone: "Asia/Jerusalem", contactDetails: "No additional phone or email sent",
      bookingKey: proposal.bookingKey, expiresAt: new Date(proposal.expiresAt).toISOString(), reservationMade: false };
  }
  function message(proposal: Proposal) {
    const p = proposal.prepared;
    return `לאשר הזמנת תור במאוחדת לחשבון המחובר?\nרופא: ${p.doctor.title} ${p.doctor.name}\nתחום: ${p.doctor.specialization}\nמיקום: ${p.doctor.address}, ${p.doctor.city}\nתאריך: ${p.choice.date}\nשעה: ${p.body.New.StartTime.slice(11, 16)}–${p.body.New.EndTime.slice(11, 16)} (ישראל)\nסוג: תור במרפאה\nלא יישלחו פרטי טלפון או דוא״ל נוספים.\nהפעולה תישלח פעם אחת. אם התוצאה לא תהיה ודאית, יש לבדוק את התורים הקיימים לפני כל ניסיון נוסף.`;
  }
  server.registerTool("meuhedet_search_doctors", {
    description: "Search Meuhedet's public doctor directory by doctor name or specialty and optional exact city. No account cookies are used. Never put patient identifiers or medical records in the query.",
    inputSchema: z.object({ query: z.string().trim().min(2).max(120), city: z.string().trim().min(1).max(80).optional(), page: z.number().int().min(0).max(100).optional(), limit: z.number().int().min(1).max(20).optional() }).strict(),
    annotations: readonly,
  }, input => safe(async () => output(await directory.searchDoctors(input))));
  server.registerTool("meuhedet_appointment_availability", {
    description: "Read monthly dates or daily time slots for a doctor ID returned by search. Appointment types: 0 clinic, 1 video, 2 phone. Requires fresh account authentication; availability is not a reservation.",
    inputSchema: z.object({ providerId: id, date, appointmentType: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0), scope: z.enum(["month", "day"]) }).strict(),
    annotations: readonly,
  }, input => safe(() => options.serialize(async () => {
    const { client } = await connected();
    const result = await client.availability(input.providerId, input.date, input.appointmentType, input.scope);
    await options.store.save(await client.exportSession());
    return output(result);
  })));
  server.registerTool("meuhedet_prepare_appointment", {
    description: "Prepare a 5-minute review proposal from an actual returned daily slot. No appointment is created. Only ordinary Meuhedet clinic doctor visits are supported; extra steps/disclaimers/external providers fail closed.",
    inputSchema: z.object({ providerId: id, date, fromTime: z.string().max(40), toTime: z.string().max(40) }).strict(), annotations: readonly,
  }, (choice: AppointmentChoice) => safe(() => options.serialize(async () => {
    for (const [key, value] of proposals) if (value.expiresAt <= now()) proposals.delete(key);
    if (proposals.size >= 100) throw new UpstreamError("TOO_MANY_BOOKING_PROPOSALS");
    const { session, client } = await connected();
    const prepared = await client.prepare(choice);
    const bookingKey = hash([choice.providerId, choice.date, prepared.body.New.StartTime, prepared.body.New.EndTime]);
    const previous = await journal.status(bookingKey);
    if (previous) return output({ bookingKey, state: previous, blocked: true, instruction: "A prior attempt exists. Check future appointments; never automatically retry." });
    await options.store.save(await client.exportSession());
    const proposalId = randomUUID(), proposal = { prepared, bookingKey, loginMarker: session.authenticatedAt, expiresAt: now() + 5 * 60_000 };
    proposals.set(proposalId, proposal);
    return output({ proposalId, review: review(proposal), executionEnabled: allowBooking, approvalRequired: true });
  })));
  async function execute(proposalId: string, signal: AbortSignal) {
    return options.serialize(async () => {
      if (signal.aborted) throw new UpstreamError("BOOKING_CANCELLED");
      const p = getProposal(proposalId), { session, client } = await connected();
      if (p.loginMarker !== session.authenticatedAt) throw new UpstreamError("BOOKING_ACCOUNT_CHANGED");
      const fresh = await client.prepare(p.prepared.choice);
      if (hash(fresh) !== hash(p.prepared)) throw new UpstreamError("BOOKING_PROPOSAL_CHANGED");
      await options.store.save(await client.exportSession());
      if (signal.aborted) throw new UpstreamError("BOOKING_CANCELLED");
      if (now() >= p.expiresAt) throw new UpstreamError("BOOKING_PROPOSAL_EXPIRED");
      if (!await journal.claim(p.bookingKey)) return output({ bookingKey: p.bookingKey, state: await journal.status(p.bookingKey), replayBlocked: true });
      let state: "outcome_uncertain" | "submitted_unverified" | "existing_appointment" = "outcome_uncertain";
      try { if (!signal.aborted) state = await client.submit(fresh); }
      catch { /* The durable claim survives every uncertain failure. */ }
      try { await journal.settle(p.bookingKey, state); } catch { state = "outcome_uncertain"; }
      proposals.delete(proposalId);
      return output({ bookingKey: p.bookingKey, state, instruction: "Verify future appointments. No automatic retry, replacement, cancellation, reminders or contact updates are performed." });
    });
  }
  server.registerTool("meuhedet_execute_appointment", {
    description: "Request host-mediated human confirmation of an exact prepared proposal, then submit once. Disabled unless MEUHEDET_ENABLE_BOOKING=1. A confirmed/approved tool argument cannot authorize booking. Never call while the user has authorized only research or code development.",
    inputSchema: proposalSchema, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ proposalId }, ctx: ServerContext) => {
    try {
      if (!allowBooking) return failure("BOOKING_DISABLED");
      const p = getProposal(proposalId), { session } = await connected();
      if (session.authenticatedAt !== p.loginMarker) return failure("BOOKING_ACCOUNT_CHANGED");
      const elicitation = server.server.getClientCapabilities()?.elicitation;
      if (!elicitation || !elicitation.form && Object.keys(elicitation).length > 0) return failure("BOOKING_APPROVAL_UNAVAILABLE");
      const response = inputResponse(ctx.mcpReq.inputResponses, "bookingApproval");
      if (response.kind !== "missing") {
        const state = ctx.mcpReq.requestState<{ proposalId: string; nonce: string }>();
        if (!p.confirmation || state?.proposalId !== proposalId || state.nonce !== p.confirmation) return failure("BOOKING_APPROVAL_INVALID");
        p.confirmation = undefined;
        if (acceptedContent(ctx.mcpReq.inputResponses, "bookingApproval", approvalSchema)?.approve !== true) {
          proposals.delete(proposalId); return output({ state: "not_approved", reservationMade: false });
        }
        return await safe(() => execute(proposalId, ctx.mcpReq.signal));
      }
      p.confirmation = randomUUID();
      return inputRequired({ requestState: await options.mintApproval(proposalId, p.confirmation, ctx), inputRequests: { bookingApproval: inputRequired.elicit({
        mode: "form", message: message(p), requestedSchema: { type: "object", properties: { approve: { type: "boolean", title: "אני מאשר את הזמנת התור המפורט" } }, required: ["approve"],
      } }) } });
    } catch (error) { return failure(error instanceof MeuhedetError ? error.code : "BOOKING_APPROVAL_UNAVAILABLE"); }
  });
  server.registerTool("meuhedet_booking_status", {
    description: "Read a local booking-attempt marker. This is not verification of a live appointment. attempting/outcome_uncertain must never trigger an automatic retry; read future appointments instead.",
    inputSchema: keySchema, annotations: { ...readonly, openWorldHint: false },
  }, ({ bookingKey }) => safe(async () => output({ bookingKey, state: await journal.status(bookingKey), upstreamValidity: "unverified" })));
}
