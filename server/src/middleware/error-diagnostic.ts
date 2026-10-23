import type { Request } from "express";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
function safeCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_]{2,80}$/.test(value) ? value : undefined;
}
export function errorDiagnostic(error: unknown) {
  const source = record(error);
  const meta = record(source.meta);
  const driver = record(meta.driverAdapterError);
  const cause = record(driver.cause ?? source.cause);
  return {
    name: safeCode(source.name), code: safeCode(source.code),
    model: safeCode(meta.modelName), databaseCode: safeCode(cause.originalCode ?? cause.code),
  };
}

export function errorDetails(error: unknown, request: Request, environment: NodeJS.ProcessEnv = process.env) {
  const privateValues = new Set<string>();
  function collect(value: unknown, depth = 0) {
    if (depth > 5) return;
    if (typeof value === "string" && value) privateValues.add(value);
    else if (typeof value === "number") privateValues.add(String(value));
    else if (typeof value === "object" && value !== null) {
      for (const item of Object.values(value).slice(0, 100)) collect(item, depth + 1);
    }
  }
  for (const [key, value] of Object.entries(environment)) {
    if (value && /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|DIRECT_URL|SMTP_USER|SMTP_FROM/i.test(key)) {
      privateValues.add(value);
      try {
        const url = new URL(value);
        if (url.password) privateValues.add(decodeURIComponent(url.password));
        if (url.username) privateValues.add(decodeURIComponent(url.username));
      } catch { /* This credential is not a URL. */ }
    }
  }
  collect(request.body);
  collect(request.query);
  collect(request.params);
  collect(request.headers?.authorization);
  collect(request.headers?.cookie);
  for (const part of (request.headers?.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0) collect(part.slice(separator + 1).trim());
  }
  function redact(value: unknown) {
    if (typeof value !== "string") return undefined;
    let text = value.slice(0, 20000);
    for (const secret of [...privateValues].sort((a, b) => b.length - a.length)) {
      text = text.split(secret).join("[REDACTED]");
    }
    return text
      .replace(/\b(postgres(?:ql)?|https?):\/\/[^\s/"']+@/gi, "$1://[REDACTED]@")
      .replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[REDACTED_TOKEN]");
  }
  function details(value: unknown, depth: number): object {
    const source = record(value);
    return {
      ...errorDiagnostic(value), message: redact(source.message), stack: redact(source.stack),
      ...(source.cause && depth < 3 ? { cause: details(source.cause, depth + 1) } : {}),
    };
  }
  return details(error, 0);
}
