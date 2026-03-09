/**
 * Stdin Adapter — Single implementation replacing 6 divergent stdin readers.
 *
 * Uses Bun.stdin.stream() with race-based timeout. Returns Result.
 */

import { type Result, ok, err } from "../result";
import { type PaiError, stdinTimeout, stdinReadFailed } from "../error";

export async function readStdin(timeoutMs: number = 200): Promise<Result<string, PaiError>> {
  try {
    const reader = Bun.stdin.stream().getReader();
    let raw = "";

    const decoder = new TextDecoder();
    const readLoop = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }
    })();

    await Promise.race([
      readLoop,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);

    if (!raw.trim()) {
      return err(stdinTimeout(timeoutMs));
    }

    return ok(raw);
  } catch (e) {
    return err(stdinReadFailed(e));
  }
}
