export abstract class HttpError extends Error {
  abstract readonly status: number;
}

export class NotFoundError extends HttpError {
  readonly status = 404;
}

export class ValidationError extends HttpError {
  readonly status = 400;
}

export class InsufficientCreditsError extends HttpError {
  readonly status = 402;
}

export class ConflictError extends HttpError {
  readonly status = 409;
}
