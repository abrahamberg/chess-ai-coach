export abstract class HttpError extends Error {
  abstract readonly status: number;
}

export class NotFoundError extends HttpError {
  readonly status = 404;
}

export class ValidationError extends HttpError {
  readonly status = 400;
}

export class ForbiddenError extends HttpError {
  readonly status = 403;
}

export class InsufficientCreditsError extends HttpError {
  readonly status = 402;
}

export class ConflictError extends HttpError {
  readonly status = 409;
}

export class RateLimitError extends HttpError {
  readonly status = 429;
}

/** Thrown when the resolved engine backend cannot serve a request right now
 * (e.g. browser-mode with no connected tunnel) — fail fast, never silently
 * fall back to a different backend (engine-backend-boundary design). */
export class EngineUnavailableError extends HttpError {
  readonly status = 503;
}
