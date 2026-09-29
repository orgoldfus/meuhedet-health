import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { MeuhedetAuth, MeuhedetClient, MeuhedetError, ReauthenticationRequired, safeClinical, type MeuhedetSession } from "@meuhedet/core";
import { FileSessionStore, type SessionStore } from "./store";
import { privatePrompt } from "./prompt";
import { startBrowserLogin } from "./browser-login";

export interface CliDependencies {
  store: SessionStore<MeuhedetSession>;
  stdout(text: string): void;
  stderr(text: string): void;
  readInput(file?: string): Promise<string>;
  prompt(label: string): Promise<string>;
  browserLogin: typeof startBrowserLogin;
  createAuth(): {
    beginLogin(details: { username: string; mobilePhoneNumber: string }): Promise<{ id: string; step: "otp" }>;
    completeLogin(id: string, code: string): Promise<MeuhedetSession>;
    cancelLogin(): Promise<void>;
  };
  connect(session: MeuhedetSession): {
    exportSession(): MeuhedetSession | Promise<MeuhedetSession>;
    prescriptions(): Promise<unknown>;
    activeMedicines(): Promise<unknown>;
    medicineApprovals(): Promise<unknown>;
    purchasedMedicines(): Promise<unknown>;
    prescriptionHistory(): Promise<unknown>;
    labStickers(): Promise<unknown>;
    labStickersRange(fromDate: string, toDate: string): Promise<unknown>;
    labSticker(labCode: string, stickerId: string, date: string): Promise<unknown>;
    futureAppointments(): Promise<unknown>;
    visitApprovals(): Promise<unknown>;
    visitReferrals(): Promise<unknown>;
  };
}
const MAX_SESSION_BYTES = 1024 * 1024;
async function readInput(file?: string): Promise<string> {
  if (file) {
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_SESSION_BYTES || process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error("Private session input must be a regular owner-only file of at most 1 MiB.");
      return await handle.readFile("utf8");
    } finally { await handle.close(); }
  }
  const stream = process.stdin;
  let content = "";
  for await (const chunk of stream) {
    content += chunk.toString();
    if (Buffer.byteLength(content) > MAX_SESSION_BYTES) throw new Error("Session input exceeds 1 MiB.");
  }
  return content;
}
function defaults(): CliDependencies {
  return {
    store: new FileSessionStore<MeuhedetSession>(),
    stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text),
    readInput,
    prompt: privatePrompt,
    browserLogin: startBrowserLogin,
    createAuth: () => new MeuhedetAuth(),
    connect: session => new MeuhedetClient({ session }),
  };
}
const HELP = `Usage: meuhedet-health <command>\n\nCommands:\n  login [--browser]              Sign in using a local page (agent) or private terminal.\n  session-import [--file PATH]   Import a private browser session JSON (or read from stdin).\n  status                         Show whether a session is saved locally (validity unverified).\n  logout                         Remove the saved session.\n  lab-stickers                   Read dashboard lab stickers.\n  lab-results --from YYYY-MM-DD --to YYYY-MM-DD\n                                 Read lab stickers in a date window.\n  lab-result --lab-code CODE --sticker-id ID --date YYYYMMDD\n                                 Read one lab sticker detail.\n  prescriptions                  Read the dashboard prescription summary.\n  active-medicines               Read active medicines.\n  medicine-approvals             Read medicine approvals.\n  purchased-medicines            Read purchased medicines.\n  prescription-history           Read prescription history.\n  future-appointments            Read future appointments.\n  visit-approvals                Read online visit approvals.\n  visit-referrals                Read online visit referrals.\n  mcp                            Run the local stdio MCP server.\n  help                           Show this help.\n\nCredentials and session contents are never accepted as arguments.\n`;
function validDate(value: string, compact = false): boolean {
  const match = compact ? /^(\d{4})(\d{2})(\d{2})$/.exec(value) : /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function flags(rest: string[], names: string[]): Record<string, string> {
  if (rest.length !== names.length * 2) throw new Error("Invalid lab arguments. See help for required flags.");
  const parsed: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i], value = rest[i + 1];
    if (!names.includes(name) || name in parsed || !value || value.startsWith("-")) throw new Error("Invalid lab arguments. See help for required flags.");
    parsed[name] = value;
  }
  return parsed;
}
export async function runCli(argv: string[], overrides: Partial<CliDependencies> = {}): Promise<number> {
  const deps = { ...defaults(), ...overrides };
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      if (rest.length) throw new Error("Unexpected arguments.");
      deps.stdout(HELP); return 0;
    }
    if (command === "status" || command === "logout") {
      if (rest.length) throw new Error("Unexpected arguments.");
      if (command === "logout") { await deps.store.delete(); deps.stdout('{"sessionSaved":false}\n'); }
      else deps.stdout(JSON.stringify({ sessionSaved: (await deps.store.load()) !== null }) + "\n");
      return 0;
    }
    if (command === "login") {
      if (rest.length === 1 && rest[0] === "--help") {
        deps.stdout("Usage: meuhedet-health login [--browser]\n\n--browser  Start a temporary local sign-in page without terminal input.\nThe agent opens the returned URL; the user enters their ID, phone and SMS code there.\nThe command waits until the session is saved, cancelled, failed or expired.\n");
        return 0;
      }
      if (rest.length === 1 && rest[0] === "--browser") {
        const flow = await deps.browserLogin({ auth: deps.createAuth(), save: session => deps.store.save(session) });
        const cancel = () => { void flow.close(); };
        process.once("SIGINT", cancel);
        process.once("SIGTERM", cancel);
        try {
          deps.stdout(`login:\n  status: awaiting_user\n  url: ${JSON.stringify(flow.url)}\n  expiresAt: ${JSON.stringify(flow.expiresAt)}\n`);
          const error = await flow.completion;
          if (error) {
            deps.stdout(`error:\n  code: ${JSON.stringify(error.code)}\n  instruction: "Check the sign-in error before starting a new meuhedet-health login --browser flow."\n`);
            return 1;
          }
          deps.stdout("sessionSaved: true\n");
          return 0;
        } finally {
          process.off("SIGINT", cancel);
          process.off("SIGTERM", cancel);
          await flow.close();
        }
      }
      if (rest.length) throw new Error("Unexpected arguments. Use login [--browser]; credentials cannot be passed as arguments.");
      const auth = deps.createAuth();
      try {
        const username = await deps.prompt("ID number: ");
        const mobilePhoneNumber = await deps.prompt("Mobile phone number: ");
        const challenge = await auth.beginLogin({ username, mobilePhoneNumber });
        const code = await deps.prompt("SMS code: ");
        const session = await auth.completeLogin(challenge.id, code);
        await deps.store.save(session);
        deps.stdout('{"sessionSaved":true}\n');
        return 0;
      } catch (error) {
        await auth.cancelLogin().catch(() => undefined);
        throw error;
      }
    }
    if (["lab-stickers", "lab-results", "lab-result", "prescriptions", "active-medicines", "medicine-approvals", "purchased-medicines", "prescription-history", "future-appointments", "visit-approvals", "visit-referrals"].includes(command)) {
      let args: string[] = [];
      if (command === "lab-results") {
        const values = flags(rest, ["--from", "--to"]);
        const from = values["--from"], to = values["--to"];
        if (!validDate(from) || !validDate(to) || from > to) throw new Error("Invalid lab arguments. Use a valid YYYY-MM-DD date window.");
        args = [from, to];
      } else if (command === "lab-result") {
        const values = flags(rest, ["--lab-code", "--sticker-id", "--date"]);
        const labCode = values["--lab-code"], stickerId = values["--sticker-id"], date = values["--date"];
        if (!/^\d+$/.test(labCode) || !/^\d+$/.test(stickerId) || !validDate(date, true)) throw new Error("Invalid lab arguments. Use numeric identifiers and a valid YYYYMMDD date.");
        args = [labCode, stickerId, date];
      } else if (rest.length) throw new Error("Unexpected arguments.");
      const saved = await deps.store.load();
      if (!saved) throw new Error("No saved session. Start login --browser.");
      const client = deps.connect(saved);
      const method = {
        "lab-stickers": "labStickers", prescriptions: "prescriptions", "active-medicines": "activeMedicines", "medicine-approvals": "medicineApprovals", "purchased-medicines": "purchasedMedicines", "prescription-history": "prescriptionHistory", "future-appointments": "futureAppointments",
        "visit-approvals": "visitApprovals", "visit-referrals": "visitReferrals",
      }[command] as "labStickers" | "prescriptions" | "activeMedicines" | "medicineApprovals" | "purchasedMedicines" | "prescriptionHistory" | "futureAppointments" | "visitApprovals" | "visitReferrals" | undefined;
      const data = command === "lab-results" ? await client.labStickersRange(args[0], args[1])
        : command === "lab-result" ? await client.labSticker(args[0], args[1], args[2]) : await client[method!]();
      const output = JSON.stringify(safeClinical(data));
      if (Buffer.byteLength(output) > 128 * 1024) throw new Error("Output too large.");
      await deps.store.save(await client.exportSession());
      deps.stdout(output + "\n");
      return 0;
    }
    if (command === "session-import") {
      if (rest.length && (rest.length !== 2 || rest[0] !== "--file" || !rest[1] || rest[1].startsWith("-"))) throw new Error("Use session-import [--file PATH], or provide JSON on stdin.");
      const serialized = await deps.readInput(rest[1]);
      let parsed: MeuhedetSession;
      try { parsed = JSON.parse(serialized) as MeuhedetSession; }
      catch { throw new Error("Session input is not valid JSON."); }
      // The core constructor validates the session schema before persistence.
      const session = await deps.connect(parsed).exportSession();
      await deps.store.save(session);
      deps.stdout('{"sessionSaved":true}\n');
      return 0;
    }
    throw new Error("Unknown command. Run meuhedet-health help.");
  } catch (error) {
    if (error instanceof ReauthenticationRequired) await deps.store.delete().catch(() => undefined);
    // Never pass upstream, JSON parser or filesystem errors through: these may include cookie values or private paths.
    const instruction = error instanceof Error && /^(Unexpected arguments|Invalid lab arguments|Use session-import|Unknown command|Session input|Private session input|No saved session|Output too large|Credentials must be entered|Interactive terminal required|Login cancelled)/.test(error.message)
      ? error.message : "The command failed. Check the saved session and local file permissions.";
    const code = error instanceof MeuhedetError ? error.code : "COMMAND_FAILED";
    deps.stderr(JSON.stringify({ error: { code, instruction: error instanceof ReauthenticationRequired ? "The saved session expired and was removed. Sign in again." : instruction } }) + "\n");
    return 2;
  }
}
