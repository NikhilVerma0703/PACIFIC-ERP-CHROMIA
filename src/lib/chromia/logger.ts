/**
 * Chromia's logger.
 *
 * The standalone module used pino (+ pino-pretty in dev). The ERP has no
 * logging dependency and adding one for a single module would mean a new
 * `serverExternalPackages` entry and a bundling story for every other module
 * that never asked for it. This is the same tiny surface the module actually
 * uses — `createLogger(module).info({ fields }, "message")` — over `console`,
 * emitting one JSON line so the output is still greppable in Vercel logs.
 */
type Fields = Record<string, unknown>;

export interface ModuleLogger {
  debug(fields: Fields | string, message?: string): void;
  info(fields: Fields | string, message?: string): void;
  warn(fields: Fields | string, message?: string): void;
  error(fields: Fields | string, message?: string): void;
  child(bindings: Fields): ModuleLogger;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const min: number =
  LEVELS[(process.env.LOG_LEVEL as Level | undefined) ?? (process.env.NODE_ENV === "production" ? "info" : "debug")] ??
  LEVELS.info;

function emit(level: Level, bindings: Fields, fields: Fields | string, message?: string) {
  if (LEVELS[level] < min) return;
  const payload = typeof fields === "string" ? { msg: fields } : { ...fields, msg: message };
  const line = JSON.stringify({ level, app: "chromia", ...bindings, ...payload }, (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function make(bindings: Fields): ModuleLogger {
  return {
    debug: (f, m) => emit("debug", bindings, f, m),
    info: (f, m) => emit("info", bindings, f, m),
    warn: (f, m) => emit("warn", bindings, f, m),
    error: (f, m) => emit("error", bindings, f, m),
    child: (b) => make({ ...bindings, ...b }),
  };
}

export const logger: ModuleLogger = make({});

export function createLogger(module: string): ModuleLogger {
  return make({ module });
}
