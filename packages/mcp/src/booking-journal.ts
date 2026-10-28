import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { configDirectory } from "@meuhedet/cli/store";
import { UpstreamError, type SubmissionOutcome } from "@meuhedet/core";

export type BookingState = "attempting" | SubmissionOutcome;
export interface BookingJournal {
  claim(key: string): Promise<boolean>;
  settle(key: string, state: SubmissionOutcome): Promise<void>;
  status(key: string): Promise<BookingState | null>;
}
const validKey = (key: string) => /^[a-f0-9]{64}$/.test(key);
/** An exclusive file creation is the cross-process claim. Claims are never automatically erased. */
export class FileBookingJournal implements BookingJournal {
  constructor(private readonly directory = join(configDirectory(), "booking-attempts")) {}
  private async folder() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new UpstreamError("BOOKING_JOURNAL_UNAVAILABLE");
  }
  private path(key: string) {
    if (!validKey(key)) throw new UpstreamError("INVALID_BOOKING_KEY");
    return join(this.directory, key + ".json");
  }
  async claim(key: string) {
    const path = this.path(key);
    try {
      await this.folder();
      const file = await open(path, "wx", 0o600);
      try { await file.writeFile(JSON.stringify({ state: "attempting" })); await file.sync(); }
      finally { await file.close(); }
      // A crash after the claim and before POST also blocks replay; conservatism prevents duplicates.
      const directory = await open(this.directory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw new UpstreamError("BOOKING_JOURNAL_UNAVAILABLE");
    }
  }
  async settle(key: string, state: SubmissionOutcome) {
    let file;
    try {
      await this.folder();
      file = await open(this.path(key), constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await file.stat();
      if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error();
      await file.truncate(0); await file.writeFile(JSON.stringify({ state })); await file.sync();
    } catch { throw new UpstreamError("BOOKING_JOURNAL_UNAVAILABLE"); }
    finally { await file?.close(); }
  }
  async status(key: string): Promise<BookingState | null> {
    let file;
    try {
      file = await open(this.path(key), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await file.stat();
      if (!info.isFile() || info.size > 512 || (info.mode & 0o077) !== 0) throw new Error();
      const data = JSON.parse(await file.readFile("utf8"));
      return ["attempting", "submitted_unverified", "existing_appointment", "outcome_uncertain"].includes(data.state) ? data.state : "outcome_uncertain";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      // A torn journal remains a claim and can never authorize a second attempt.
      return "outcome_uncertain";
    } finally { await file?.close(); }
  }
}
