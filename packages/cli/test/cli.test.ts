import { expect, it, vi } from "vitest";
import { ReauthenticationRequired, type MeuhedetSession } from "@meuhedet/core";
import { runCli, type CliDependencies } from "../src/cli";

function fixture() {
  let saved: MeuhedetSession | null = null;
  const out: string[] = [], err: string[] = [];
  const session = { version: 1, provider: "meuhedet", cookies: {}, authenticatedAt: "2026-01-01T00:00:00.000Z" } as unknown as MeuhedetSession;
  const deps: CliDependencies = {
    store: { load: async () => saved, save: async value => { saved = value; }, delete: async () => { saved = null; } },
    stdout: text => { out.push(text); }, stderr: text => { err.push(text); },
    readInput: async () => JSON.stringify(session),
    prompt: async () => "123456",
    browserLogin: async () => { throw Error("unused"); },
    createAuth: () => ({ beginLogin: async () => ({ id: "challenge", step: "otp" }), completeLogin: async () => session, cancelLogin: async () => {} }),
    connect: value => ({ exportSession: () => value, prescriptions: async () => ({ data: [{ drug: "sample" }] }), activeMedicines: async () => ({ Items: ["active"] }), medicineApprovals: async () => ({}), purchasedMedicines: async () => ({}), prescriptionHistory: async () => ({}), labStickers: async () => [], labStickersRange: async (from, to) => ({ from, to, Items: [] }), labSticker: async (labCode, stickerId, date) => ({ labCode, stickerId, date, testSections: [] }), futureAppointments: async () => ({ data: [] }), visitApprovals: async () => [], visitReferrals: async () => [] }),
  };
  return { deps, out, err };
}

it("imports privately, reports local presence, reads and logs out", async () => {
  const f = fixture();
  expect(await runCli(["session-import"], f.deps)).toBe(0);
  expect(f.out.at(-1)).toBe('{"sessionSaved":true}\n');
  expect(await runCli(["status"], f.deps)).toBe(0);
  expect(f.out.at(-1)).toBe('{"sessionSaved":true}\n');
  expect(await runCli(["prescriptions"], f.deps)).toBe(0);
  expect(JSON.parse(f.out.at(-1)!)).toEqual({ data: [{ drug: "sample" }] });
  expect(await runCli(["active-medicines"], f.deps)).toBe(0);
  expect(JSON.parse(f.out.at(-1)!)).toEqual({ Items: ["active"] });
  expect(await runCli(["logout"], f.deps)).toBe(0);
  expect(f.out.at(-1)).toBe('{"sessionSaved":false}\n');
});

it("completes a prompted OTP login without printing entered secrets", async () => {
  const f = fixture();
  let called: unknown;
  f.deps.createAuth = () => ({
    beginLogin: async details => { called = details; return { id: "challenge", step: "otp" }; },
    completeLogin: async (id, code) => { expect({ id, code }).toEqual({ id: "challenge", code: "123456" }); return (await f.deps.connect({} as MeuhedetSession).exportSession()); },
    cancelLogin: async () => {},
  });
  expect(await runCli(["login"], f.deps)).toBe(0);
  expect(called).toEqual({ username: "123456", mobilePhoneNumber: "123456" });
  expect(f.out.join("")).not.toContain("123456");
});

it("starts agent-managed sign-in without terminal prompts and closes it after completion", async () => {
  const f = fixture();
  const close = vi.fn(async () => {});
  f.deps.prompt = async () => { throw Error("A browser flow must not prompt in the terminal"); };
  f.deps.browserLogin = async options => {
    await options.save(await f.deps.connect({} as MeuhedetSession).exportSession());
    return { url: "http://127.0.0.1:1234/#synthetic-capability", expiresAt: "2026-01-01T00:10:00.000Z", completion: Promise.resolve(undefined), close };
  };
  expect(await runCli(["login", "--browser"], f.deps)).toBe(0);
  expect(f.out.join("")).toContain("status: awaiting_user");
  expect(f.out.join("")).toContain("sessionSaved: true");
  expect(close).toHaveBeenCalledTimes(1);
  expect(await runCli(["status"], f.deps)).toBe(0);
  expect(f.out.at(-1)).toBe('{"sessionSaved":true}\n');
});

it("rejects unknown login flags before opening a page or making an authentication request", async () => {
  const f = fixture();
  f.deps.browserLogin = vi.fn(f.deps.browserLogin);
  expect(await runCli(["login", "--browser", "--unknown"], f.deps)).toBe(2);
  expect(f.deps.browserLogin).not.toHaveBeenCalled();
});

it("does not echo secrets from a failed upstream read", async () => {
  const f = fixture();
  await runCli(["session-import"], f.deps);
  f.deps.connect = () => ({ exportSession: () => { throw Error("unused"); }, prescriptions: async () => { throw Error("cookie=secret-value"); }, activeMedicines: async () => ({}), medicineApprovals: async () => ({}), purchasedMedicines: async () => ({}), prescriptionHistory: async () => ({}), labStickers: async () => [], labStickersRange: async () => [], labSticker: async () => ({}), futureAppointments: async () => [], visitApprovals: async () => [], visitReferrals: async () => [] });
  expect(await runCli(["prescriptions"], f.deps)).toBe(2);
  expect(f.err.join("")).not.toContain("secret-value");
});

it("removes an expired session after an account read", async () => {
  const f = fixture();
  await runCli(["session-import"], f.deps);
  f.deps.connect = () => ({ exportSession: () => { throw Error("unused"); }, prescriptions: async () => { throw new ReauthenticationRequired(401); }, activeMedicines: async () => ({}), medicineApprovals: async () => ({}), purchasedMedicines: async () => ({}), prescriptionHistory: async () => ({}), labStickers: async () => [], labStickersRange: async () => [], labSticker: async () => ({}), futureAppointments: async () => [], visitApprovals: async () => [], visitReferrals: async () => [] });
  expect(await runCli(["prescriptions"], f.deps)).toBe(2);
  expect(JSON.parse(f.err.at(-1)!)).toMatchObject({ error: { code: "REAUTHENTICATION_REQUIRED" } });
  expect(await runCli(["status"], f.deps)).toBe(0);
  expect(f.out.at(-1)).toBe('{"sessionSaved":false}\n');
});

it("routes validated lab range and detail arguments and never echoes invalid values", async () => {
  const f = fixture();
  await runCli(["session-import"], f.deps);
  expect(await runCli(["lab-results", "--from", "2026-02-01", "--to", "2026-02-28"], f.deps)).toBe(0);
  expect(JSON.parse(f.out.at(-1)!)).toEqual({ from: "2026-02-01", to: "2026-02-28", Items: [] });
  expect(await runCli(["lab-result", "--lab-code", "001", "--sticker-id", "123", "--date", "20260228"], f.deps)).toBe(0);
  expect(JSON.parse(f.out.at(-1)!)).toEqual({ labCode: "001", stickerId: "123", date: "20260228", testSections: [] });
  for (const args of [["lab-results", "--from", "2026-02-30", "--to", "2026-03-01"], ["lab-results", "--from", "2026-03-01", "--to", "2026-02-01"], ["lab-result", "--lab-code", "../../secret", "--sticker-id", "1", "--date", "20260101"]]) {
    expect(await runCli(args, f.deps)).toBe(2);
  }
  expect(f.err.join("")).not.toContain("../../secret");
  expect(f.err.join("")).not.toContain("2026-02-30");
});
