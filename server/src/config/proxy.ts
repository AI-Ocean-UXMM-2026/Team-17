import type { Express } from "express";

export function configureProxy(app: Express, environment: NodeJS.ProcessEnv = process.env) {
  // Vercel supplies the client address through its own immediate reverse proxy.
  app.set("trust proxy", environment.VERCEL === "1" ? 1 : false);
}
