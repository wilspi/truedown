import type { FailureKind } from "../../shared/types";
import type { MonitorRow } from "../db/types";

const MAX_ASSERTION_BYTES = 64 * 1024;
const MAX_EXCERPT_BYTES = 2048;

export interface CheckResult {
  successful: boolean;
  checkedAt: number;
  latencyMs: number;
  httpStatus: number | null;
  error: string | null;
  failureKind: FailureKind | null;
  responseBody: string | null;
  responseHeaders: Record<string, string>;
}

export async function checkMonitor(monitor: MonitorRow): Promise<CheckResult> {
  const checkedAt = Math.floor(Date.now() / 1000);
  const startedAt = performance.now();

  let httpStatus: number | null = null;
  let responseHeaders: Record<string, string> = {};
  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      redirect: monitor.follow_redirects === 1 ? "follow" : "manual",
      signal: AbortSignal.timeout(monitor.timeout_ms),
      headers: {
        Accept: monitor.expected_keyword ? "text/plain, application/json;q=0.9, */*;q=0.1" : "*/*",
        "User-Agent": "TrueDown/0.1 (+https://github.com/wilspi/truedown)",
      },
    });
    httpStatus = response.status;
    responseHeaders = diagnosticHeaders(response.headers);
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

    if (
      response.status < monitor.expected_status_min ||
      response.status > monitor.expected_status_max
    ) {
      return {
        successful: false,
        checkedAt,
        latencyMs,
        httpStatus: response.status,
        failureKind: "http",
        responseBody: await failureExcerpt(response),
        responseHeaders,
        error: `Expected HTTP ${monitor.expected_status_min}-${monitor.expected_status_max}, received ${response.status}.`,
      };
    }

    if (monitor.expected_keyword) {
      const body = await readBoundedBody(response, MAX_ASSERTION_BYTES, monitor.expected_keyword);
      if (!body.found) {
        return {
          successful: false,
          checkedAt,
          latencyMs,
          httpStatus: response.status,
          failureKind: "keyword",
          responseBody: truncateToBytes(body.text, MAX_EXCERPT_BYTES),
          responseHeaders,
          error: `Expected response text was not found in the first ${MAX_ASSERTION_BYTES / 1024} KiB.`,
        };
      }
    } else {
      await safelyCancelBody(response);
    }

    return {
      successful: true,
      checkedAt,
      latencyMs,
      httpStatus: response.status,
      error: null,
      failureKind: null,
      responseBody: null,
      responseHeaders: {},
    };
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    return {
      successful: false,
      checkedAt,
      latencyMs,
      httpStatus,
      failureKind: isTimeout(error) ? "timeout" : httpStatus === null ? "network" : "body",
      responseBody: null,
      responseHeaders,
      error: describeFetchError(error, monitor.timeout_ms, httpStatus !== null),
    };
  }
}

interface BoundedBody {
  text: string;
  /** Whether `until` appeared; reading stops there, so a stalled stream cannot fail a passing check. */
  found: boolean;
}

async function readBoundedBody(response: Response, byteLimit: number, until?: string): Promise<BoundedBody> {
  if (!response.body) return { text: "", found: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  let finished = false;

  try {
    while (totalBytes < byteLimit) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      const remaining = byteLimit - totalBytes;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      totalBytes += chunk.byteLength;
      // Rescan only the new text plus enough overlap to catch a match split across chunks.
      const searchFrom = Math.max(0, text.length - (until?.length ?? 0) + 1);
      text += decoder.decode(chunk, { stream: true });
      if (until && text.includes(until, searchFrom)) return { text, found: true };
    }
    text += decoder.decode();
    return { text, found: until ? text.includes(until) : false };
  } finally {
    if (!finished) {
      try {
        await reader.cancel();
      } catch {
        // The peer may already have closed the body; the check result remains valid.
      }
    }
    reader.releaseLock();
  }
}

async function safelyCancelBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Releasing the connection is best-effort after response headers were received.
  }
}

function describeFetchError(error: unknown, timeoutMs: number, headersReceived: boolean): string {
  if (isTimeout(error)) {
    // Fixed wording per phase: consecutive failures with identical errors merge into one stored run.
    return headersReceived
      ? `Timed out after ${timeoutMs} ms reading the response body.`
      : `Timed out after ${timeoutMs} ms waiting for a response.`;
  }
  if (error instanceof Error) {
    return `Request failed: ${error.message.slice(0, 220)}`;
  }
  return "Request failed for an unknown reason.";
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function diagnosticHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ["content-type", "retry-after", "cf-ray", "x-request-id", "x-correlation-id"]) {
    const value = headers.get(name);
    if (value) result[name] = value.slice(0, 256);
  }
  return result;
}

async function failureExcerpt(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/|json|xml/i.test(contentType)) {
    await safelyCancelBody(response);
    return null;
  }
  try {
    return (await readBoundedBody(response, MAX_EXCERPT_BYTES)).text;
  } catch {
    // Preserve the HTTP failure even when its response body cannot be read.
    return null;
  }
}

function truncateToBytes(text: string, byteLimit: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= byteLimit) return text;
  // Streaming mode drops a trailing partial character instead of emitting U+FFFD.
  return new TextDecoder().decode(bytes.subarray(0, byteLimit), { stream: true });
}
