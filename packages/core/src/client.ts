import { ReauthenticationRequired, UpstreamError } from "./errors";
import { safeClinical } from "./privacy";
import type { MeuhedetSession } from "./session";
import { MeuhedetTransport, PORTAL_ORIGIN, readCapped, type TransportOptions } from "./transport";

/** Read-only calls observed in Meuhedet's public first-party eservices bundle. */
export class MeuhedetClient {
  readonly transport: MeuhedetTransport;
  constructor(options: TransportOptions = {}) { this.transport = new MeuhedetTransport(options); }
  async exportSession(): Promise<MeuhedetSession> { return this.transport.exportSession(); }
  async logout(): Promise<void> { await this.transport.clearSession(); }

  /** Small dashboard preview. */
  async labStickers(): Promise<unknown> { return readApi(this.transport, "PersonalDashboardApi/LabStickers", false, "Stickers"); }
  /** Lab list for an explicit date window; server boundary semantics are unverified. */
  async labStickersRange(fromDate: string, toDate: string): Promise<unknown> {
    const from = localDay(fromDate);
    const to = localDay(toDate);
    if (from.getTime() > to.getTime()) throw new UpstreamError("INVALID_DATE_RANGE");
    return readClinical(this.transport, new URL("/umbraco/api/LabApi/Stickers", PORTAL_ORIGIN), {
      method: "POST",
      body: JSON.stringify({ FromDate: shiftedIso(from), ToDate: shiftedIso(to) }),
    }, "Items", "HiddenItems");
  }
  /** Detail route used by the lab-sticker page. Date is the yyyyMMdd path date. */
  async labSticker(labCode: string, stickerId: string, date: string): Promise<unknown> {
    if (!/^\d+$/.test(labCode) || !/^\d+$/.test(stickerId) || !/^\d{8}$/.test(date) ||
      !validCompactDay(date))
      throw new UpstreamError("INVALID_LAB_STICKER_REFERENCE");
    const url = new URL(`/api/labs/${labCode}/stickers/${stickerId}`, PORTAL_ORIGIN);
    url.searchParams.set("date", date);
    const value = await readClinical(this.transport, url, { headers: { "x-node-id": "8414" } });
    if (Array.isArray(value) || value === null || typeof value !== "object" ||
      !Array.isArray((value as Record<string, unknown>).testSections) ||
      typeof (value as Record<string, unknown>).detailsSection !== "object" ||
      (value as Record<string, unknown>).detailsSection === null)
      throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
    return value;
  }
  /** Active medications endpoint returns a root array. */
  async activeMedicines(): Promise<unknown> {
    const value = await readClinical(this.transport, new URL("/api/medications/active/all", PORTAL_ORIGIN), { headers: { "x-node-id": "41057" } });
    if (!Array.isArray(value)) throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
    return value;
  }
  async medicineApprovals(): Promise<unknown> {
    return readClinical(this.transport, new URL("/api/medications/meds/approvals", PORTAL_ORIGIN), { headers: { "x-node-id": "41057" } }, "Approvals");
  }
  async purchasedMedicines(): Promise<unknown> {
    return readClinical(this.transport, new URL("/api/medications/meds/purchased", PORTAL_ORIGIN), { headers: { "x-node-id": "41057" } }, "Items");
  }
  async prescriptionHistory(): Promise<unknown> {
    return readClinical(this.transport, new URL("/api/medications/prescriptions", PORTAL_ORIGIN), { headers: { "x-node-id": "41057" } }, "prescriptions");
  }
  async prescriptions(): Promise<unknown> { return this.#read("PersonalDashboardApi/Prescriptions", false, "Items"); }
  async futureAppointments(): Promise<unknown> { return this.#read("AppointmentApi/FutureAppointmentsOnly", true); }
  async visitApprovals(): Promise<unknown> { return this.#read("OnlineCommunicationApi/GetVisitsApprovals"); }
  async visitReferrals(): Promise<unknown> { return this.#read("OnlineCommunicationApi/GetVisitsRefs"); }

  async #read(path: string, post = false, collection?: string): Promise<unknown> {
    return readApi(this.transport, path, post, collection);
  }
}

function localDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new UpstreamError("INVALID_DATE_RANGE");
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(year, month - 1, day);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day)
    throw new UpstreamError("INVALID_DATE_RANGE");
  return result;
}
function validCompactDay(value: string): boolean {
  try { localDay(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`); return true; }
  catch { return false; }
}
function shiftedIso(date: Date): string {
  return new Date(date.getTime() - 60_000 * date.getTimezoneOffset()).toISOString();
}

/** Also used to confirm login with the same headers as normal account reads. */
export async function readApi(transport: MeuhedetTransport, path: string, post = false, collection?: string): Promise<unknown> {
    const url = new URL("/umbraco/api/" + path, PORTAL_ORIGIN);
    return readClinical(transport, url, post ? { method: "POST", body: "{}" } : {}, ...(collection ? [collection] : []));
}
async function readClinical(transport: MeuhedetTransport, url: URL, init: RequestInit = {}, ...collections: string[]): Promise<unknown> {
    if (!transport.hasSession) throw new ReauthenticationRequired();
    url.searchParams.set("uniq_param", String(Date.now()));
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries({
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      locale: "he-IL",
      "x-node-id": "2327",
      "x-requested-with": "XMLHttpRequest",
      "x-platform": "1",
    })) if (!headers.has(key)) headers.set(key, value);
    const response = await transport.request(url, {
      ...init,
      method: init.method ?? "GET",
      headers,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new UpstreamError("HTTP_ERROR", response.status);
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("json")) {
      await response.body?.cancel().catch(() => undefined);
      await transport.clearSession();
      throw new ReauthenticationRequired(response.status);
    }
    const raw = await readCapped(response);
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { throw new UpstreamError("INVALID_JSON", response.status); }
    if (value === null || typeof value !== "object") throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE", response.status);
    if ("Message" in value) throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE", response.status);
    for (const collection of collections) {
      if (!Array.isArray((value as Record<string, unknown>)[collection]))
        throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE", response.status);
    }
    return safeClinical(value);
}
export function connect(session: MeuhedetSession): MeuhedetClient {
  return new MeuhedetClient({ session });
}
