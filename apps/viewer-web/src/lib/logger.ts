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

  consoleMethod(prefix, details);
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
