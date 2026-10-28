import { describe, expect, it, vi } from "vitest";
import { CookieJar } from "tough-cookie";
import { MeuhedetAppointmentClient, jerusalemValue } from "../src/appointments";
import { MeuhedetDirectory } from "../src/directory";
import type { MeuhedetSession } from "../src/session";

const provider = { Id: "2_demo", Type: 2, Name: "רופא דוגמה", Title: "דר׳", City: "עיר דוגמה", Address: "רחוב דוגמה", HouseNumber: "1", Specialization: "אורתופדיה", DoctorOrganizationCode: 0, AvailabileForOnLine: true };
const choice = { providerId: provider.Id, date: "2026-11-20", fromTime: "2026-11-20T09:00:00+02:00", toTime: "2026-11-20T09:15:00+02:00" };
// Synthetic values reproduce only the structural shape observed in live clinic reads.
const context = () => ({ session: { id: provider.Id, type: 2, appointmentType: 0, allowedTypes: [0], prevalidation: null as unknown },
  details: { organizationCode: 0 }, markers: { restricted: false as unknown },
  meta: { disclaimer: null as unknown, billing: null as unknown, messages: { group: null, aptType: null, subType: null } as unknown },
  steps: [{ blocks: ["details.block"] }, { blocks: ["datepicker.block"] }, { blocks: ["summary.block"] }] });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
async function fixture(allowBooking = false, change?: (c: ReturnType<typeof context>) => void) {
  const session: MeuhedetSession = { version: 1, provider: "meuhedet", authenticatedAt: "2026-10-14T00:00:00Z", cookies: await new CookieJar().serialize() };
  const metadata = context(); change?.(metadata);
  const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(input.toString());
    if (url.pathname.includes("RecordIndexSearch")) return json(provider);
    if (url.pathname.includes("/start/")) return json(metadata);
    if (url.pathname.includes("/daily/")) return json([{ fromTime: choice.fromTime, toTime: choice.toTime, patientId: "must-not-return" }]);
    if (url.pathname.includes("/monthly/")) return json([{ day: choice.date + "T00:00:00", available: true }]);
    if (url.pathname === "/api/appointment/create") return json({});
    throw Error("Unexpected endpoint");
  });
  return { client: new MeuhedetAppointmentClient({ session, fetch, allowBooking }), fetch };
}
describe("public doctor directory", () => {
  it("uses public configuration and bounded filters without account cookies or output keys", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      expect(new Headers(init?.headers).has("cookie")).toBe(false);
      if (url.hostname === "online.meuhedet.co.il") return json({ AlgoliaConfiguration: { Aid: "DEMOAPP", RoKey: "synthetic-search-only", Env: "prod", Idx: "poi" } });
      expect(url.hostname).toBe("demoapp-dsn.algolia.net");
      const body = JSON.parse(init?.body as string);
      expect(new URLSearchParams(body.requests[0].params).get("filters")).toBe('Type:2 AND City:"עיר דוגמה"');
      return json({ results: [{ hits: [{ ...provider, patientId: "private", objectID: "opaque" }], nbHits: 1, nbPages: 1 }] });
    });
    const result = await new MeuhedetDirectory(fetch).searchDoctors({ query: "אורתופד", city: "עיר דוגמה" });
    expect(result.doctors[0]).toMatchObject({ id: "2_demo", name: "רופא דוגמה", specialization: "אורתופדיה" });
    expect(JSON.stringify(result)).not.toMatch(/private|synthetic-search-only|objectID/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid searches before fetching and refuses configuration host injection", async () => {
    const fetch = vi.fn(async () => json({ AlgoliaConfiguration: { Aid: "host.evil", RoKey: "synthetic", Env: "prod", Idx: "poi" } }));
    const directory = new MeuhedetDirectory(fetch);
    await expect(directory.searchDoctors({ query: "x" })).rejects.toMatchObject({ code: "INVALID_DOCTOR_SEARCH" });
    expect(fetch).not.toHaveBeenCalled();
    await expect(directory.searchDoctors({ query: "doctor" })).rejects.toMatchObject({ code: "PUBLIC_SEARCH_CONFIG_CHANGED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe("appointment contracts and mutation boundary", () => {
  it("reads modern schemas, minimizes output and prepares without a mutation", async () => {
    const { client, fetch } = await fixture();
    expect(await client.availability("2_demo", choice.date, 0, "month")).toMatchObject({ days: [{ date: choice.date, available: true }] });
    expect(JSON.stringify(await client.availability("2_demo", choice.date, 0, "day"))).not.toContain("must-not-return");
    const p = await client.prepare(choice);
    expect(p.body).toEqual({ New: { PoiId: "2_demo", PoiType: 2, Type: 0, DoctorOrganizationCode: 0, Platform: null, Date: "2026-11-20T00:00:00+02:00", StartTime: choice.fromTime, EndTime: choice.toTime, Phone: null, Email: null, PrefId: null } });
    expect(fetch.mock.calls.every(c => !c[0].toString().includes("/api/appointment/create"))).toBe(true);
    await expect(client.submit(p)).rejects.toMatchObject({ code: "BOOKING_DISABLED" });
  });
  it.each(["questionnaire", "disclaimer", "prevalidation"])("fails closed for %s", async condition => {
    const { client } = await fixture(false, c => {
      if (condition === "questionnaire") c.steps.push({ blocks: ["generated-view.block"] });
      if (condition === "disclaimer") c.meta.disclaimer = { type: 1 };
      if (condition === "prevalidation") c.session.prevalidation = { valid: false };
    });
    await expect(client.prepare(choice)).rejects.toMatchObject({ code: "UNSUPPORTED_APPOINTMENT_FLOW" });
  });
  it("accepts an affirmative prevalidation result as well as the observed null value", async () => {
    const { client, fetch } = await fixture(false, c => { c.session.prevalidation = { valid: true, block: false, message: null }; });
    expect((await client.prepare(choice)).doctor.id).toBe(provider.Id);
    expect(fetch.mock.calls.some(c => c[0].toString().includes("/api/appointment/create"))).toBe(false);
  });
  it.each([
    ["missing prevalidation", (c: ReturnType<typeof context>) => { c.session.prevalidation = undefined; }],
    ["blocked valid prevalidation", (c: ReturnType<typeof context>) => { c.session.prevalidation = { valid: true, block: true }; }],
    ["prevalidation message", (c: ReturnType<typeof context>) => { c.session.prevalidation = { valid: true, message: "Requires review" }; }],
    ["restricted visit", (c: ReturnType<typeof context>) => { c.markers.restricted = true; }],
    ["missing restricted marker", (c: ReturnType<typeof context>) => { c.markers.restricted = undefined; }],
    ["required billing", (c: ReturnType<typeof context>) => { c.meta.billing = { required: true }; }],
    ["unknown billing", (c: ReturnType<typeof context>) => { c.meta.billing = {}; }],
    ["referral message", (c: ReturnType<typeof context>) => { c.meta.messages = { group: "נדרשת הפניה" }; }],
    ["unknown message category", (c: ReturnType<typeof context>) => { c.meta.messages = { newCondition: null }; }],
    ["legacy unobserved blocks", (c: ReturnType<typeof context>) => { c.steps = [{ blocks: ["date-and-time.block", "confirm.block"] }]; }],
    ["reordered blocks", (c: ReturnType<typeof context>) => { c.steps.reverse(); }],
    ["duplicate block", (c: ReturnType<typeof context>) => { c.steps.push({ blocks: ["summary.block"] }); }],
    ["different provider", (c: ReturnType<typeof context>) => { c.session.id = "2_other"; }],
    ["different appointment type", (c: ReturnType<typeof context>) => { c.session.appointmentType = 1; }],
    ["external provider", (c: ReturnType<typeof context>) => { c.details.organizationCode = 1; }],
  ])("stops before slot validation or any create request for %s", async (_condition, change) => {
    const { client, fetch } = await fixture(true, change as (c: ReturnType<typeof context>) => void);
    await expect(client.prepare(choice)).rejects.toMatchObject({ code: "UNSUPPORTED_APPOINTMENT_FLOW" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.some(c => c[0].toString().includes("/daily/") || c[0].toString().includes("/api/appointment/create"))).toBe(false);
  });
  it("rejects unavailable slots, invalid dates and provider path injection", async () => {
    const { client, fetch } = await fixture();
    await expect(client.prepare({ ...choice, fromTime: "2026-11-20T08:00:00+02:00" })).rejects.toMatchObject({ code: "APPOINTMENT_SLOT_UNAVAILABLE" });
    const count = fetch.mock.calls.length;
    await expect(client.availability("../../private", choice.date, 0, "day")).rejects.toMatchObject({ code: "INVALID_PROVIDER_ID" });
    await expect(client.availability("2_demo", "2026-02-30", 0, "day")).rejects.toMatchObject({ code: "INVALID_APPOINTMENT_DATE" });
    expect(fetch).toHaveBeenCalledTimes(count);
  });
  it("uses one mutation request with manual redirects and never claims verified booking", async () => {
    const { client, fetch } = await fixture(true), p = await client.prepare(choice);
    expect(await client.submit(p)).toBe("submitted_unverified");
    const [url, init] = fetch.mock.calls.at(-1)!;
    expect(new URL(url.toString()).pathname).toBe("/api/appointment/create");
    expect(init?.redirect).toBe("manual");
    expect(JSON.parse(init?.body as string)).toEqual(p.body);
  });
  it.each(["network", "redirect", "server", "malformed"])("treats %s failure as uncertain without retrying", async failure => {
    const { client, fetch } = await fixture(true), p = await client.prepare(choice);
    fetch.mockImplementationOnce(async () => {
      if (failure === "network") throw Error("cookie=private");
      if (failure === "redirect") return new Response(null, { status: 307, headers: { location: "https://online.meuhedet.co.il/api/appointment/create" } });
      if (failure === "server") return json({ patientId: "private" }, 500);
      return new Response("private", { headers: { "content-type": "application/json" } });
    });
    const count = fetch.mock.calls.length;
    expect(await client.submit(p)).toBe("outcome_uncertain");
    expect(fetch).toHaveBeenCalledTimes(count + 1);
  });
  it("returns an existing-appointment conflict without replacing it", async () => {
    const { client, fetch } = await fixture(true), p = await client.prepare(choice);
    fetch.mockImplementationOnce(async () => json({ existingAppointment: { patientId: "private" } }));
    expect(await client.submit(p)).toBe("existing_appointment");
    expect(fetch.mock.calls.some(c => c[0].toString().includes("update"))).toBe(false);
  });
  it("rejects altered payloads and repeated direct submission before any network request", async () => {
    const { client, fetch } = await fixture(true), p = await client.prepare(choice);
    p.body.New.StartTime = "2026-11-20T08:00:00+02:00";
    const count = fetch.mock.calls.length;
    await expect(client.submit(p)).rejects.toMatchObject({ code: "BOOKING_PREPARATION_INVALID" });
    expect(fetch).toHaveBeenCalledTimes(count);
    const fresh = await client.prepare(choice);
    await client.submit(fresh);
    const submittedCount = fetch.mock.calls.length;
    await expect(client.submit(fresh)).rejects.toMatchObject({ code: "BOOKING_PREPARATION_INVALID" });
    expect(fetch).toHaveBeenCalledTimes(submittedCount);
  });
  it("uses Jerusalem offsets across DST and ignores the host timezone", () => {
    expect(jerusalemValue("2026-07-01T00:00:00")).toBe("2026-07-01T00:00:00+03:00");
    expect(jerusalemValue("2026-11-20T00:00:00")).toBe("2026-11-20T00:00:00+02:00");
    expect(jerusalemValue("2026-11-20T07:00:00Z")).toBe("2026-11-20T09:00:00+02:00");
  });
});
