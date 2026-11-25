// One structured JSON line per event, so Workers Logs can filter on `message` and fields.
type LogFields = Record<string, unknown>;

function write(level: "log" | "warn" | "error", message: string, fields: LogFields): void {
  console[level](JSON.stringify({ message, ...fields }));
}

export const log = {
  info: (message: string, fields: LogFields = {}) => write("log", message, fields),
  warn: (message: string, fields: LogFields = {}) => write("warn", message, fields),
  error: (message: string, fields: LogFields = {}) => write("error", message, fields),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
