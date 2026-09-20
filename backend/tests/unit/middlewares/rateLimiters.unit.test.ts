import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { loginRateLimiter, profileUploadRateLimiter } from "../../../src/middlewares/rateLimit/rateLimiters";

function appWithLimiter(limiter: express.RequestHandler) {
  const app = express();
  app.post("/probe", limiter, (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("loginRateLimiter", () => {
  it("allows requests under the limit and blocks once it's exceeded", async () => {
    const app = appWithLimiter(loginRateLimiter);

    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/probe");
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post("/probe");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many login attempts/i);
  });
});

describe("profileUploadRateLimiter", () => {
  it("allows requests under the limit and blocks once it's exceeded", async () => {
    const app = appWithLimiter(profileUploadRateLimiter);

    for (let i = 0; i < 30; i++) {
      const res = await request(app).post("/probe");
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post("/probe");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many profile uploads/i);
  });
});
