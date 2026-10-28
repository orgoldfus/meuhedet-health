import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileBookingJournal } from "../src/booking-journal";

it("atomically claims across independent instances, persists uncertainty and contains no patient data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meuhedet-journal-test-")), key = "a".repeat(64);
  try {
    const a = new FileBookingJournal(dir), b = new FileBookingJournal(dir);
    expect((await Promise.all([a.claim(key), b.claim(key)])).sort()).toEqual([false, true]);
    await a.settle(key, "outcome_uncertain");
    expect(await new FileBookingJournal(dir).status(key)).toBe("outcome_uncertain");
    expect(await b.claim(key)).toBe(false);
    expect(JSON.parse(await readFile(join(dir, key + ".json"), "utf8"))).toEqual({ state: "outcome_uncertain" });
    expect((await stat(join(dir, key + ".json"))).mode & 0o077).toBe(0);
    await writeFile(join(dir, key + ".json"), "{", { mode: 0o600 });
    expect(await a.status(key)).toBe("outcome_uncertain"); expect(await a.claim(key)).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
