import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";

// Use Express's trusted proxy result, with IPv6 subnet grouping. Do not trust
// arbitrary Forwarded headers or the leftmost user-supplied X-Forwarded-For entry.
export function clientIpKey(request: Request) {
  return ipKeyGenerator(request.ip || request.socket.remoteAddress || "unknown");
}
