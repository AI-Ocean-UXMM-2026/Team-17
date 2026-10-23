import express from "express";
import cors from "cors";

export const corsMiddleware = cors({
  origin: "*",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
});

export const jsonBodyParser = express.json({ limit: "16kb" });
