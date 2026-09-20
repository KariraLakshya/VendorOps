import pino from "pino";

/**
 * Structured JSON logger. All application logs — and, critically, every
 * step of the AI recommendation pipeline (start time, parsing time,
 * matching time, final score, errors) — are emitted as structured JSON
 * records rather than free-text strings, per the Observability requirement.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "zelosify-recruit-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;

export const agentLogger = logger.child({ component: "recommendation-agent" });
