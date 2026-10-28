import { UpstreamError } from "./errors";
import { PORTAL_ORIGIN, readCapped, type FetchFunction } from "./transport";

export interface DoctorSearch {
  query: string;
  city?: string;
  page?: number;
  limit?: number;
}
export interface Doctor {
  id: string;
  type: 2;
  name: string;
  title: string;
  specialization: string;
  city: string;
  address: string;
  onlineAppointments: boolean;
  organizationCode: number;
}
export function providerId(value: string): void {
  if (!/^2_[A-Za-z0-9_-]{1,150}$/.test(value)) throw new UpstreamError("INVALID_PROVIDER_ID");
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
  return value as Record<string, unknown>;
}
export function doctor(value: unknown): Doctor {
  const v = object(value);
  if (typeof v.Id !== "string" || v.Type !== 2 || typeof v.Name !== "string" ||
      typeof v.City !== "string" || typeof v.DoctorOrganizationCode !== "number")
    throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
  providerId(v.Id);
  const text = (key: string) => typeof v[key] === "string" ? v[key] as string : "";
  return { id: v.Id, type: 2, name: v.Name, title: text("Title"), specialization: text("Specialization"), city: v.City,
    address: [text("Address"), text("HouseNumber")].filter(Boolean).join(" "),
    onlineAppointments: v.AvailabileForOnLine === true, organizationCode: v.DoctorOrganizationCode };
}

/** Public directory only. Portal account cookies never reach the search provider. */
export class MeuhedetDirectory {
  constructor(private readonly fetch: FetchFunction = globalThis.fetch) {}
  private async json(url: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try { response = await this.fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new UpstreamError("PUBLIC_SEARCH_NETWORK_ERROR"); }
    if (!response.ok) { await response.body?.cancel(); throw new UpstreamError("PUBLIC_SEARCH_HTTP_ERROR", response.status); }
    if (!response.headers.get("content-type")?.includes("json")) throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
    try { return JSON.parse(await readCapped(response)); }
    catch { throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE"); }
  }
  async searchDoctors(input: DoctorSearch): Promise<{ doctors: Doctor[]; page: number; pages: number; total: number }> {
    const page = input.page ?? 0, limit = input.limit ?? 10;
    if (typeof input.query !== "string" || input.query.trim().length < 2 || input.query.length > 120 ||
        input.city !== undefined && (typeof input.city !== "string" || !input.city.trim() || input.city.length > 80) ||
        !Number.isInteger(page) || page < 0 || page > 100 || !Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new UpstreamError("INVALID_DOCTOR_SEARCH");
    const config = object(await this.json(PORTAL_ORIGIN + "/umbraco/api/configurationapi/Vars?nodeId=37538270-5ef9-424c-ba74-e26eee0aae9d"));
    const c = object(config.AlgoliaConfiguration);
    if (typeof c.Aid !== "string" || !/^[A-Za-z0-9]{6,20}$/.test(c.Aid) || typeof c.RoKey !== "string" || !c.RoKey ||
        typeof c.Env !== "string" || !/^[A-Za-z0-9_]+$/.test(c.Env) || c.Idx !== "poi")
      throw new UpstreamError("PUBLIC_SEARCH_CONFIG_CHANGED");
    const filters = "Type:2" + (input.city ? ` AND City:${JSON.stringify(input.city.trim())}` : "");
    const params = new URLSearchParams({ query: input.query.trim(), filters, page: String(page), hitsPerPage: String(limit) });
    const data = object(await this.json(`https://${c.Aid.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`, {
      method: "POST", headers: { "content-type": "application/json", "x-algolia-application-id": c.Aid, "x-algolia-api-key": c.RoKey },
      body: JSON.stringify({ requests: [{ indexName: `${c.Env}_${c.Idx}`, params: params.toString() }] }),
    }));
    if (!Array.isArray(data.results) || data.results.length !== 1) throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
    const result = object(data.results[0]);
    if (!Array.isArray(result.hits) || !Number.isInteger(result.nbHits) || !Number.isInteger(result.nbPages))
      throw new UpstreamError("UNEXPECTED_RESPONSE_SHAPE");
    return { doctors: result.hits.map(doctor), page, pages: result.nbPages as number, total: result.nbHits as number };
  }
}
