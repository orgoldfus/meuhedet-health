import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Secrets are never included in file-system error messages. */
export class SessionStoreError extends Error {
  readonly code = "SESSION_STORE_UNAVAILABLE";
  constructor() { super("The private session file could not be read or written. Check the Meuhedet config directory permissions."); }
}

export function configDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MEUHEDET_CONFIG_DIR) return env.MEUHEDET_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "meuhedet-health");
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "meuhedet-health");
  return join(homedir(), ".config", "meuhedet-health");
}

export interface SessionStore<T> {
  load(): Promise<T | null>;
  save(value: T): Promise<void>;
  delete(): Promise<void>;
}
const MAX_SESSION_BYTES = 1024 * 1024;
function privateMode(mode: number): boolean {
  return process.platform === "win32" || (mode & 0o077) === 0;
}

/** An atomically replaced owner-only file. Refuses symlinks and group-readable files on Unix. */
export class FileSessionStore<T = unknown> implements SessionStore<T> {
  constructor(private readonly path = join(configDirectory(), "session.json")) {}

  private async checkDirectory(): Promise<void> {
    const info = await lstat(dirname(this.path));
    if (!info.isDirectory() || !privateMode(info.mode)) throw new SessionStoreError();
  }

  async load(): Promise<T | null> {
    try {
      await this.checkDirectory();
      const file = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await file.stat();
        if (!stat.isFile() || !privateMode(stat.mode) || stat.size > MAX_SESSION_BYTES) throw new SessionStoreError();
        // O_NOFOLLOW is used on platforms supporting it; the post-open check also rejects non-files.
        return JSON.parse(await file.readFile("utf8")) as T;
      } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new SessionStoreError();
    }
  }

  async save(value: T): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await this.checkDirectory();
      const serialized = JSON.stringify(value);
      if (Buffer.byteLength(serialized) > MAX_SESSION_BYTES) throw new SessionStoreError();
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(serialized); } finally { await file.close(); }
      await rename(temporary, this.path);
    } catch {
      await unlink(temporary).catch(() => undefined);
      throw new SessionStoreError();
    }
  }

  async delete(): Promise<void> {
    try { await unlink(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new SessionStoreError(); }
  }
}
