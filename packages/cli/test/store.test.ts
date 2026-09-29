import { afterEach, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { FileSessionStore, SessionStoreError } from "../src/store";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it("atomically saves and removes a private session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meuhedet-store-"));
  dirs.push(dir);
  const path = join(dir, "config", "session.json");
  const store = new FileSessionStore<{ token: string }>(path);
  expect(await store.load()).toBeNull();
  await store.save({ token: "secret" });
  expect(await store.load()).toEqual({ token: "secret" });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ token: "secret" });
  if (process.platform !== "win32") expect((await stat(path)).mode & 0o077).toBe(0);
  await store.delete();
  expect(await store.load()).toBeNull();
});

it("rejects a symlink without revealing target contents", async () => {
  if (process.platform === "win32") return;
  const dir = await mkdtemp(join(tmpdir(), "meuhedet-store-"));
  dirs.push(dir);
  const target = join(dir, "target");
  await new FileSessionStore(target).save({ token: "secret" });
  const link = join(dir, "session.json");
  await symlink(target, link);
  await expect(new FileSessionStore(link).load()).rejects.toBeInstanceOf(SessionStoreError);
});

it("refuses loose config permissions and oversized saved files", async () => {
  if (process.platform === "win32") return;
  const dir = await mkdtemp(join(tmpdir(), "meuhedet-store-"));
  dirs.push(dir);
  const config = join(dir, "config");
  await mkdir(config, { mode: 0o755 });
  const path = join(config, "session.json");
  const store = new FileSessionStore(path);
  await expect(store.save({ token: "secret" })).rejects.toBeInstanceOf(SessionStoreError);
  await chmod(config, 0o700);
  await writeFile(path, "x".repeat(1024 * 1024 + 1), { mode: 0o600 });
  await expect(store.load()).rejects.toBeInstanceOf(SessionStoreError);
});
