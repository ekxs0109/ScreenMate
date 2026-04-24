type LogLevel = "debug" | "info" | "warn" | "error";

export function createLogger(scope: string) {
  return {
    debug(message: string, details?: unknown) {
      writeLog("debug", scope, message, details);
    },
    info(message: string, details?: unknown) {
      writeLog("info", scope, message, details);
    },
    warn(message: string, details?: unknown) {
      writeLog("warn", scope, message, details);
    },
    error(message: string, details?: unknown) {
      writeLog("error", scope, message, details);
    },
  };
}

function writeLog(
  level: LogLevel,
  scope: string,
  message: string,
  details?: unknown,
) {
  const prefix = `[ScreenMate:${scope}] ${message}`;
  const consoleMethod = getConsoleMethod(level);

  if (details === undefined) {
    consoleMethod(prefix);
    return;
  }

  consoleMethod(prefix, serializeLogDetails(details));
}

function getConsoleMethod(level: LogLevel) {
  switch (level) {
    case "debug":
      return console.debug.bind(console);
    case "warn":
      return console.warn.bind(console);
    case "error":
      return console.error.bind(console);
    case "info":
    default:
      return console.log.bind(console);
  }
}

function serializeLogDetails(details: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(details, (_key, value: unknown) => {
      if (typeof value === "string") {
        return sanitizeLogString(value);
      }

      if (typeof value === "bigint") {
        return value.toString();
      }

      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }

      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }

        seen.add(value);
      }

      return value;
    }) ?? "undefined";
  } catch (error) {
    return JSON.stringify({
      serializationError:
        error instanceof Error ? error.message : String(error),
    });
  }
}

function sanitizeLogString(value: string) {
  if (value.startsWith("data:")) {
    return `${value.slice(0, 48)}...[truncated:${value.length}]`;
  }

  if (value.length > 500) {
    return `${value.slice(0, 500)}...[truncated:${value.length}]`;
  }

  return value;
}
