import { UpstreamError, ReauthenticationRequired } from "./errors";
import { doctor, object, providerId, type Doctor } from "./directory";
import { MeuhedetTransport, PORTAL_ORIGIN, readCapped, type TransportOptions } from "./transport";

export type AppointmentType = 0 | 1 | 2;
export interface TimeSlot { fromTime: string; toTime: string; }
export interface AppointmentChoice { providerId: string; date: string; fromTime: string; toTime: string; }
export interface PreparedAppointment {
  doctor: Doctor;
  choice: AppointmentChoice;
  body: { New: { PoiId: string; PoiType: 2; Type: 0; DoctorOrganizationCode: 0; Platform: null;
    Date: string; StartTime: string; EndTime: string; Email: null; Phone: null; PrefId: null; } };
}
export type SubmissionOutcome = "submitted_unverified" | "existing_appointment" | "outcome_uncertain";

export function calendarDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    throw new UpstreamError("INVALID_APPOINTMENT_DATE");
}
function slot(value: unknown): TimeSlot {
  const v = object(value);
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/;
  if (typeof v.fromTime !== "string" || typeof v.toTime !== "string" || !iso.test(v.fromTime) || !iso.test(v.toTime) ||
      !Number.isFinite(Date.parse(v.fromTime)) || !Number.isFinite(Date.parse(v.toTime)))
    throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
  return { fromTime: v.fromTime, toTime: v.toTime };
}

/** Match the portal's moment formatting in Israel rather than the server's local timezone. */
export function jerusalemValue(value: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const wallAt = (utc: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(p => [p.type, p.value]));
    return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const offsetAt = (utc: number) => Math.round((Date.parse(wallAt(utc) + "Z") - Math.floor(utc / 1000) * 1000) / 60_000);
  const suffix = (offset: number) => `${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!hasZone) {
    const wall = value.slice(0, 19);
    const utc = Date.parse(wall + "Z");
    if (!Number.isFinite(utc)) throw new UpstreamError("INVALID_APPOINTMENT_DATE");
    const offset = offsetAt(utc - offsetAt(utc) * 60_000);
    if (wallAt(utc - offset * 60_000) !== wall) throw new UpstreamError("INVALID_APPOINTMENT_DATE");
    return wall + suffix(offset);
  }
  const utc = Date.parse(value);
  if (!Number.isFinite(utc)) throw new UpstreamError("INVALID_APPOINTMENT_DATE");
  return wallAt(utc) + suffix(offsetAt(utc));
}

export class MeuhedetAppointmentClient {
  readonly transport: MeuhedetTransport;
  private readonly prepared = new WeakMap<PreparedAppointment, string>();
  constructor(options: TransportOptions & { allowBooking?: boolean } = {}) {
    this.transport = new MeuhedetTransport(options);
    this.allowBooking = options.allowBooking === true;
  }
  private readonly allowBooking: boolean;
  exportSession() { return this.transport.exportSession(); }
  private async read(path: string): Promise<unknown> {
    if (!this.transport.hasSession) throw new ReauthenticationRequired();
    const url = new URL(path, PORTAL_ORIGIN); url.searchParams.set("uniq_param", String(Date.now()));
    const response = await this.transport.request(url, { headers: {
      accept: "application/json, text/plain, */*", locale: "he-IL", "x-node-id": "2327", "x-requested-with": "XMLHttpRequest", "x-platform": "1",
    } });
    if (!response.ok) { await response.body?.cancel(); throw new UpstreamError("HTTP_ERROR", response.status); }
    if (!response.headers.get("content-type")?.includes("json")) { await response.body?.cancel(); throw new ReauthenticationRequired(response.status); }
    let data: unknown;
    try { data = JSON.parse(await readCapped(response)); }
    catch { throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE"); }
    if (data && typeof data === "object" && ("Message" in data || "ModelState" in data)) throw new UpstreamError("APPOINTMENT_READ_REJECTED");
    return data;
  }
  async availability(id: string, date: string, appointmentType: AppointmentType, scope: "month" | "day") {
    providerId(id); calendarDate(date);
    if (![0, 1, 2].includes(appointmentType) || !["month", "day"].includes(scope)) throw new UpstreamError("INVALID_APPOINTMENT_QUERY");
    const [year, month, day] = date.split("-").map(Number);
    const params = new URLSearchParams({ month: String(month), year: String(year) });
    if (scope === "day") params.set("day", String(day));
    const result = await this.read(`/api/appointment/${scope === "month" ? "monthly" : "daily"}/2/${encodeURIComponent(id)}/${appointmentType}?${params}`);
    if (!Array.isArray(result)) throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
    if (scope === "day") return { scope, providerId: id, date, appointmentType, slots: result.map(slot) };
    return { scope, providerId: id, date, appointmentType, days: result.map(value => {
      const v = object(value);
      if (typeof v.day !== "string" || typeof v.available !== "boolean") throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
      calendarDate(v.day.slice(0, 10));
      return { date: v.day.slice(0, 10), available: v.available };
    }) };
  }
  async prepare(choice: AppointmentChoice): Promise<PreparedAppointment> {
    providerId(choice.providerId); calendarDate(choice.date);
    slot(choice);
    const provider = doctor(await this.read(`/umbraco/api/IndexSearchApi/RecordIndexSearch?poiType=2&id=${encodeURIComponent(choice.providerId)}&calcDistance=false`));
    if (provider.id !== choice.providerId || !provider.onlineAppointments || provider.organizationCode !== 0)
      throw new UpstreamError("UNSUPPORTED_APPOINTMENT_FLOW");
    const context = object(await this.read(`/api/appointment/start/2/${encodeURIComponent(choice.providerId)}/0/create`));
    const session = object(context.session), details = object(context.details), meta = object(context.meta), markers = object(context.markers);
    // The live clinic wizard supplies null when there is no prevalidation alert.
    // Its frontend only shows an alert for a non-null, non-valid result.
    const prevalidation = session.prevalidation;
    const validation = prevalidation && typeof prevalidation === "object" && !Array.isArray(prevalidation) ? object(prevalidation) : undefined;
    const validPrevalidation = prevalidation === null || validation &&
      validation.valid === true && (validation.block === undefined || validation.block === false) &&
      (validation.message === undefined || validation.message === null || validation.message === "");
    const noBilling = meta.billing == null || typeof meta.billing === "object" && !Array.isArray(meta.billing) && object(meta.billing).required === false;
    const messageKeys = ["group", "aptType", "subType"];
    const noMessages = meta.messages == null || typeof meta.messages === "object" && !Array.isArray(meta.messages) &&
      Object.keys(meta.messages).every(key => messageKeys.includes(key)) &&
      Object.values(meta.messages).every(value => value === null || value === "");
    if (session.id !== choice.providerId || session.type !== 2 || session.appointmentType !== 0 ||
        !Array.isArray(session.allowedTypes) || !session.allowedTypes.includes(0) || details.organizationCode !== 0 ||
        !validPrevalidation || markers.restricted !== false || !noBilling || !noMessages || meta.disclaimer !== null || !Array.isArray(context.steps))
      throw new UpstreamError("UNSUPPORTED_APPOINTMENT_FLOW");
    const blocks = context.steps.flatMap(value => {
      const v = object(value); if (!Array.isArray(v.blocks)) throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
      return v.blocks;
    });
    const clinicBlocks = ["details.block", "datepicker.block", "summary.block"];
    if (blocks.length !== clinicBlocks.length || blocks.some((block, index) => block !== clinicBlocks[index]))
      throw new UpstreamError("UNSUPPORTED_APPOINTMENT_FLOW");
    const available = await this.availability(choice.providerId, choice.date, 0, "day");
    if (!available.slots?.some(s => s.fromTime === choice.fromTime && s.toTime === choice.toTime)) throw new UpstreamError("APPOINTMENT_SLOT_UNAVAILABLE");
    const prepared: PreparedAppointment = { doctor: provider, choice: { ...choice }, body: { New: {
      PoiId: provider.id, PoiType: 2, Type: 0, DoctorOrganizationCode: 0, Platform: null,
      Date: jerusalemValue(choice.date + "T00:00:00"), StartTime: jerusalemValue(choice.fromTime), EndTime: jerusalemValue(choice.toTime),
      Email: null, Phone: null, PrefId: null,
    } } };
    this.prepared.set(prepared, JSON.stringify(prepared));
    return prepared;
  }
  /** Called only after host-mediated approval and a durable duplicate-prevention claim. Never retried. */
  async submit(prepared: PreparedAppointment): Promise<SubmissionOutcome> {
    if (!this.allowBooking) throw new UpstreamError("BOOKING_DISABLED");
    if (this.prepared.get(prepared) !== JSON.stringify(prepared)) throw new UpstreamError("BOOKING_PREPARATION_INVALID");
    this.prepared.delete(prepared);
    const url = new URL("/api/appointment/create?session=undefined", PORTAL_ORIGIN);
    try {
      const response = await this.transport.request(url, { method: "POST", redirect: "manual", body: JSON.stringify(prepared.body), headers: {
        "content-type": "application/json", accept: "application/json", locale: "he-IL", "x-node-id": "2327", "x-requested-with": "XMLHttpRequest", "x-platform": "1",
      } });
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) { await response.body?.cancel(); return "outcome_uncertain"; }
      const result = object(JSON.parse(await readCapped(response)));
      if (result.existingAppointment) return "existing_appointment";
      if ("Message" in result || "ModelState" in result || "error" in result) return "outcome_uncertain";
      return "submitted_unverified";
    } catch { return "outcome_uncertain"; }
  }
}
