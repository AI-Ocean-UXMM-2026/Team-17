import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors/app-error";
import { errorDiagnostic, errorDetails } from "./error-diagnostic";

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const details = process.env.API_ERROR_DETAILS === "true" ? errorDetails(error, _req) : undefined;
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request data." } });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({ success: false, error: { code: error.code, message: error.message,
      ...(error.status >= 500 && details ? { details } : {}),
    } });
    return;
  }
  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body." } });
    return;
  }
  // Codes identify infrastructure/schema failures without logging credentials, SQL, or request data.
  console.error("Unhandled API error", details ?? errorDiagnostic(error));
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.",
    ...(details ? { details } : {}),
  } });
};
