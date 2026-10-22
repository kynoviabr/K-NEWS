type LogLevel = "debug" | "info" | "warn" | "error";

function log(level: LogLevel, service: string, message: string, metadata?: Record<string, unknown>) {
  const entry = {
    level,
    service,
    message,
    metadata: metadata ?? {},
    timestamp: new Date().toISOString(),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (service: string, message: string, metadata?: Record<string, unknown>) => log("debug", service, message, metadata),
  info: (service: string, message: string, metadata?: Record<string, unknown>) => log("info", service, message, metadata),
  warn: (service: string, message: string, metadata?: Record<string, unknown>) => log("warn", service, message, metadata),
  error: (service: string, message: string, metadata?: Record<string, unknown>) => log("error", service, message, metadata),
};
