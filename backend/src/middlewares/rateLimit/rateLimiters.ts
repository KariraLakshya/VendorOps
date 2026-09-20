import rateLimit from "express-rate-limit";

/**
 * Rate limiters for the two categories of endpoint most worth protecting:
 * unauthenticated auth endpoints (brute-force/credential-stuffing/spam
 * targets) and the profile upload endpoint (each accepted file triggers a
 * real, paid LLM call via the agent service, so it's also a cost/DoS
 * surface, not just a traffic one).
 *
 * Keyed by IP (express-rate-limit's default) — coarse, but this app has
 * no API gateway in front of it yet to key on something better (API key,
 * authenticated user id), and coarse-but-present beats absent.
 */

/** Login/TOTP verification: the classic brute-force target. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

/** Registration: cheaper to guess than a password, but still worth capping to deter spam account creation. */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." },
});

/** Profile uploads: each file costs a real LLM call downstream. */
export const profileUploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many profile uploads. Please try again later." },
});
