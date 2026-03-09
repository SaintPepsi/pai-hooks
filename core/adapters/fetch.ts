/**
 * Fetch Adapter — HTTP requests wrapped in Result with timeout via AbortController.
 */

import { type Result, ok, err } from "../result";
import { type PaiError, fetchFailed, fetchTimeout } from "../error";

export interface FetchResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export async function safeFetch(
  url: string,
  opts: { timeout?: number; method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Result<FetchResult, PaiError>> {
  const controller = new AbortController();
  const timeoutMs = opts.timeout ?? 5000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => { headers[k] = v; });

    return ok({ status: response.status, body, headers });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      return err(fetchTimeout(url, timeoutMs));
    }
    return err(fetchFailed(url, e));
  }
}
