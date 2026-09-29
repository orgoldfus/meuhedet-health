/** TTY-only, non-echoing prompt. No secret is placed in argv or terminal output. */
export async function privatePrompt(label: string): Promise<string> {
  const input = process.stdin, output = process.stderr;
  if (!input.isTTY || !output.isTTY) throw new Error("Interactive terminal required for login.");
  return new Promise((resolve, reject) => {
    let value = "", finished = false;
    const raw = input.isRaw;
    const finish = (cancelled: boolean) => {
      if (finished) return;
      finished = true;
      input.off("data", onData);
      input.off("error", onError);
      input.setRawMode(raw);
      input.pause();
      output.write("\n");
      if (cancelled) reject(new Error("Login cancelled.")); else resolve(value);
    };
    const onError = () => finish(true);
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (finished) break;
        if (char === "\r" || char === "\n") finish(false);
        else if (char === "\x03" || char === "\x04") finish(true);
        else if (char === "\x7f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " " && char !== "\x1b" && value.length < 128) value += char;
      }
    };
    output.write(label);
    input.setRawMode(true);
    input.on("data", onData);
    input.on("error", onError);
    input.resume();
  });
}
