import type { NextFunction, Request, Response } from "express";
import {
  AlreadyInGameError,
  AuthError,
  ConflictError,
  ForbiddenError,
  InsufficientBalanceError,
  NotFoundError,
  ValidationError,
} from "../errors";
import { MatchNotFoundError } from "../matchmaking/joinQueue";

function statusOf(error: unknown): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof AuthError) return 401;
  if (error instanceof InsufficientBalanceError) return 402;
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError || error instanceof AlreadyInGameError) return 409;
  if (error instanceof MatchNotFoundError) return 503;
  // a body that is not valid JSON
  if (error instanceof SyntaxError && "status" in error && error.status === 400) return 400;
  return 500;
}

// the only place that turns an error into an HTTP answer; internal details never go out
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const status = statusOf(error);
  if (status === 500) console.error("unhandled error", req.method, req.path, error);
  const message = status === 500 ? "internal error" : error instanceof Error ? error.message : "error";
  res.status(status).json({ error: message });
}
