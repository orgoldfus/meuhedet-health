import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";
import { createMeuhedetMcpServer } from "../src/tools";
import type { BookingJournal, BookingState } from "../src/booking-journal";
import { type MeuhedetSession, type PreparedAppointment, UpstreamError } from "@meuhedet/core";

const choice = { providerId: "2_demo", date: "2026-11-20", fromTime: "2026-11-20T09:00:00+02:00", toTime: "2026-11-20T09:15:00+02:00" };
const prepared: PreparedAppointment = { choice, doctor: { id: "2_demo", type: 2, name: "רופא דוגמה", title: "דר׳", specialization: "אורתופדיה", city: "עיר דוגמה", address: "רחוב דוגמה 1", organizationCode: 0, onlineAppointments: true }, body: { New: { PoiId: "2_demo", PoiType: 2, Type: 0, DoctorOrganizationCode: 0, Platform: null, Date: "2026-11-20T00:00:00+02:00", StartTime: choice.fromTime, EndTime: choice.toTime, Phone: null, Email: null, PrefId: null } } };
async function fixture(allowBooking = true, host = true, journalOverride?: BookingJournal) {
  let clock = Date.parse("2026-10-14T00:00:00Z");
  let session = { provider: "meuhedet", version: 1, authenticatedAt: "synthetic-login", cookies: {} } as unknown as MeuhedetSession;
  const entries = new Map<string, BookingState>();
  const journal: BookingJournal = journalOverride ?? {
    claim: async key => { if (entries.has(key)) return false; entries.set(key, "attempting"); return true; },
    settle: async (key, value) => { entries.set(key, value); }, status: async key => entries.get(key) ?? null,
  };
  const operations = { prepare: vi.fn(async () => structuredClone(prepared)), availability: vi.fn(async () => ({ scope: "day" as const, providerId: "2_demo", date: choice.date, appointmentType: 0 as const, slots: [choice] })), submit: vi.fn(async () => "submitted_unverified" as const), exportSession: async () => session };
  const server = createMeuhedetMcpServer({ store: { load: async () => session, save: async () => {}, delete: async () => {} }, appointments: () => operations, bookingJournal: journal, allowBooking, now: () => clock });
  const client = new Client({ name: "synthetic-booking-test", version: "1" }, { capabilities: host ? { elicitation: { form: {} } } : {} });
  const approval = vi.fn(async () => ({ action: "accept" as const, content: { approve: true } }));
  if (host) client.setRequestHandler("elicitation/create", approval);
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  const propose = async () => (await client.callTool({ name: "meuhedet_prepare_appointment", arguments: choice })).structuredContent as Record<string, unknown>;
  const execute = (proposalId: string) => client.callTool({ name: "meuhedet_execute_appointment", arguments: { proposalId } });
  return { client, operations, approval, propose, execute, journal, expire: () => { clock += 300_001; }, switchAccount: () => { session = { ...session, authenticatedAt: "different-login" }; }, close: async () => { await client.close(); await server.close(); } };
}
it("requires exact host approval, revalidates and blocks repeat submission", async () => {
  const f = await fixture();
  try {
    const p = await f.propose();
    expect(p.review).toMatchObject({ reservationMade: false, timezone: "Asia/Jerusalem" });
    expect(f.operations.submit).not.toHaveBeenCalled();
    expect((await f.execute(p.proposalId as string)).structuredContent).toMatchObject({ state: "submitted_unverified" });
    expect(f.approval).toHaveBeenCalledTimes(1);
    expect(f.operations.prepare).toHaveBeenCalledTimes(2);
    expect(f.operations.submit).toHaveBeenCalledTimes(1);
    const duplicate = await f.propose();
    expect(duplicate).toMatchObject({ blocked: true, state: "submitted_unverified" });
    await f.execute(p.proposalId as string);
    expect(f.operations.submit).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
});
it.each(["disabled", "unsupported-host", "denied", "expired", "account-changed", "changed-slot"])("does not mutate when %s", async reason => {
  const f = await fixture(reason !== "disabled", reason !== "unsupported-host");
  try {
    const p = await f.propose();
    if (reason === "denied") f.approval.mockImplementation(async () => ({ action: "accept", content: { approve: false } }));
    if (reason === "expired") f.expire();
    if (reason === "account-changed") f.switchAccount();
    if (reason === "changed-slot") f.operations.prepare.mockRejectedValueOnce(new UpstreamError("APPOINTMENT_SLOT_UNAVAILABLE"));
    await f.execute(p.proposalId as string);
    expect(f.operations.submit).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
it("rejects a model-supplied confirmed flag", async () => {
  const f = await fixture();
  try {
    const p = await f.propose();
    expect((await f.client.callTool({ name: "meuhedet_execute_appointment", arguments: { proposalId: p.proposalId, confirmed: true } })).isError).toBe(true);
    expect(f.operations.submit).not.toHaveBeenCalled(); expect(f.approval).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
it("keeps an uncertain attempt across server restarts and never retries", async () => {
  const f = await fixture();
  try {
    const p = await f.propose();
    f.operations.submit.mockRejectedValueOnce(Error("cookie=private"));
    const result = await f.execute(p.proposalId as string);
    expect(result.structuredContent).toMatchObject({ state: "outcome_uncertain" });
    expect(JSON.stringify(result)).not.toContain("private");
    const next = await fixture(true, true, f.journal);
    try { expect(await next.propose()).toMatchObject({ blocked: true, state: "outcome_uncertain" }); expect(next.operations.submit).not.toHaveBeenCalled(); }
    finally { await next.close(); }
  } finally { await f.close(); }
});
it("submits once when two separately approved proposals race for the same slot", async () => {
  const f = await fixture();
  try {
    const first = await f.propose(), second = await f.propose();
    const results = await Promise.all([f.execute(first.proposalId as string), f.execute(second.proposalId as string)]);
    expect(f.operations.submit).toHaveBeenCalledTimes(1);
    expect(results.some(r => (r.structuredContent as Record<string, unknown> | undefined)?.replayBlocked === true)).toBe(true);
  } finally { await f.close(); }
});
