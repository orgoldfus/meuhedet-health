import { describe, expect, it, vi } from "vitest";
import { CookieJar } from "tough-cookie";
import { MeuhedetClient } from "../src/client";
import { PORTAL_ORIGIN } from "../src/transport";

async function session() {
  const jar = new CookieJar();
  await jar.setCookie("portal=secret; Secure; HttpOnly; Path=/", PORTAL_ORIGIN);
  return { provider: "meuhedet" as const, version: 1 as const, cookies: await jar.serialize(), authenticatedAt: new Date().toISOString() };
}

describe("first-party lab page contracts (synthetic responses)", () => {
  it("posts the lab page's exact date keys and preserves both visible and hidden items", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      Items: [{ LabCode: "12", StickerId: "34", TestDate: "2026-09-02", patientId: "private" }],
      HiddenItems: [{ LabCode: "56", StickerId: "78" }], TotalCount: 2,
    }), { headers: { "content-type": "application/json" } }));
    const client = new MeuhedetClient({ session: await session(), fetch });
    expect(await client.labStickersRange("2026-09-01", "2026-09-29")).toEqual({
      Items: [{ LabCode: "12", StickerId: "34", TestDate: "2026-09-02" }],
      HiddenItems: [{ LabCode: "56", StickerId: "78" }], TotalCount: 2,
    });
    expect(fetch.mock.calls[0][0].toString()).toMatch(/\/umbraco\/api\/LabApi\/Stickers\?uniq_param=\d+$/);
    expect(fetch.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({
      FromDate: "2026-09-01T00:00:00.000Z", ToDate: "2026-09-29T00:00:00.000Z",
    });
  });

  it("gets the detail page endpoint with three validated route arguments", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      detailsSection: { files: [] }, testSections: [{ tests: [{ records: [{ value: "positive", panicLevel: 0 }] }] }],
      pregnancySection: null, patientId: "private",
    }), { headers: { "content-type": "application/json" } }));
    const client = new MeuhedetClient({ session: await session(), fetch });
    expect(await client.labSticker("12", "34", "20260902")).toEqual({
      detailsSection: { files: [] }, testSections: [{ tests: [{ records: [{ value: "positive", panicLevel: 0 }] }] }],
      pregnancySection: null,
    });
    expect(fetch.mock.calls[0][0].toString()).toMatch(/^https:\/\/online\.meuhedet\.co\.il\/api\/labs\/12\/stickers\/34\?date=20260902&uniq_param=\d+$/);
  });

  it("rejects invalid dates and route tokens before sending anything", async () => {
    const fetch = vi.fn();
    const client = new MeuhedetClient({ session: await session(), fetch });
    await expect(client.labStickersRange("2026-02-30", "2026-03-01")).rejects.toMatchObject({ code: "INVALID_DATE_RANGE" });
    await expect(client.labSticker("12/other", "34", "20260902")).rejects.toMatchObject({ code: "INVALID_LAB_STICKER_REFERENCE" });
    await expect(client.labSticker("12", "34", "20260230")).rejects.toMatchObject({ code: "INVALID_LAB_STICKER_REFERENCE" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not treat malformed success payloads as empty lab results", async () => {
    const client = new MeuhedetClient({ session: await session(), fetch: async () =>
      new Response(JSON.stringify({ testSections: [] }), { headers: { "content-type": "application/json" } }) });
    await expect(client.labSticker("12", "34", "20260902")).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE_SHAPE" });
    await expect(client.labStickersRange("2026-09-01", "2026-09-29")).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE_SHAPE" });
  });
  it("reads medication routes and checks their distinct collection shapes", async () => {
    const replies: Record<string, unknown> = {
      "/api/medications/active/all": [{ name: "Example", token: "private" }],
      "/api/medications/meds/approvals": { Approvals: [] },
      "/api/medications/meds/purchased": { Items: [] },
      "/api/medications/prescriptions": { prescriptions: [] },
    };
    const fetch = vi.fn(async (input: string | URL | Request) => new Response(
      JSON.stringify(replies[new URL(input.toString()).pathname]),
      { headers: { "content-type": "application/json" } },
    ));
    const client = new MeuhedetClient({ session: await session(), fetch });
    expect(await client.activeMedicines()).toEqual([{ name: "Example" }]);
    expect(await client.medicineApprovals()).toEqual({ Approvals: [] });
    expect(await client.purchasedMedicines()).toEqual({ Items: [] });
    expect(await client.prescriptionHistory()).toEqual({ prescriptions: [] });
    expect(fetch.mock.calls.map(call => new URL(call[0].toString()).pathname)).toEqual(Object.keys(replies));
  });
});
