import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { ReauthenticationRequired, type MeuhedetSession } from "@meuhedet/core";
import { createMeuhedetMcpServer } from "../src/tools";

it("exposes only the bounded read catalog and saves a refreshed session", async () => {
  const saved = { provider: "meuhedet", version: 1, authenticatedAt: "2026-01-01", cookies: {} } as unknown as MeuhedetSession;
  let writes = 0;
  const server = createMeuhedetMcpServer({
    store: { load: async () => saved, save: async () => { writes++; }, delete: async () => {} },
    connect: () => ({
      exportSession: async () => saved,
      labStickers: async () => ({ data: [] }),
      labStickersRange: async (fromDate, toDate) => ({ Items: [{ date: fromDate, toDate, password: "private" }] }),
      labSticker: async (labCode, stickerId, date) => ({ labCode, stickerId, date, testSections: [{ name: "Hemoglobin", value: "13" }] }),
      prescriptions: async () => ({ data: [{ title: "example", password: "private" }] }),
      activeMedicines: async () => ({ Items: ["active"] }), medicineApprovals: async () => ({}), purchasedMedicines: async () => ({}), prescriptionHistory: async () => ({}),
      futureAppointments: async () => ({ data: [] }),
      visitApprovals: async () => ({ data: [] }),
      visitReferrals: async () => ({ data: [] }),
    }),
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(["meuhedet_prescriptions", "meuhedet_future_appointments", "meuhedet_session_status"]));
    expect(names.every(name => name.startsWith("meuhedet_"))).toBe(true);
    const read = await client.callTool({ name: "meuhedet_prescriptions", arguments: {} });
    expect(JSON.stringify(read)).toContain("example");
    expect(JSON.stringify(read)).not.toContain("private");
    expect(writes).toBe(1);
    const range = await client.callTool({ name: "meuhedet_lab_results", arguments: { fromDate: "2026-02-01", toDate: "2026-02-28" } });
    expect(JSON.stringify(range)).toContain("2026-02-01");
    expect(JSON.stringify(range)).not.toContain("private");
    const detail = await client.callTool({ name: "meuhedet_lab_result", arguments: { labCode: "001", stickerId: "42", date: "20260228" } });
    expect(JSON.stringify(detail)).toContain("Hemoglobin");
    expect(writes).toBe(3);
    const medicine = await client.callTool({ name: "meuhedet_active_medicines", arguments: {} });
    expect(JSON.stringify(medicine)).toContain("active");
    expect(writes).toBe(4);
    const invalid = await client.callTool({ name: "meuhedet_lab_result", arguments: { labCode: "../secret", stickerId: "42", date: "20260228" } });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain("../secret");
    expect(writes).toBe(4);
  } finally { await client.close(); await server.close(); }
});

it("invalidates an expired session without exposing upstream details", async () => {
  const saved = { provider: "meuhedet", version: 1, authenticatedAt: "2026-01-01", cookies: {} } as unknown as MeuhedetSession;
  let deleted = false;
  const server = createMeuhedetMcpServer({
    store: { load: async () => deleted ? null : saved, save: async () => {}, delete: async () => { deleted = true; } },
    connect: () => ({
      exportSession: async () => saved,
      labStickers: async () => { throw new ReauthenticationRequired(401); },
      labStickersRange: async () => ({}), labSticker: async () => ({}),
      activeMedicines: async () => ({}), medicineApprovals: async () => ({}), purchasedMedicines: async () => ({}), prescriptionHistory: async () => ({}),
      prescriptions: async () => ({}), futureAppointments: async () => ({}), visitApprovals: async () => ({}), visitReferrals: async () => ({}),
    }),
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const response = await client.callTool({ name: "meuhedet_lab_stickers", arguments: {} });
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({ error: { code: "REAUTHENTICATION_REQUIRED" } });
    expect(deleted).toBe(true);
  } finally { await client.close(); await server.close(); }
});
