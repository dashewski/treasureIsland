import type { NextFunction, Request, Response } from "express";
import { AuthError } from "../errors";
import { verifyJWT } from "./jwt";

declare module "express-serve-static-core" {
  interface Request {
    playerId?: string;
  }
}

// every route except /api/auth/telegram goes through this: the player comes only from the token
export function authMiddleware(secret: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) {
      next(new AuthError("no token"));
      return;
    }
    try {
      req.playerId = verifyJWT(header.slice("Bearer ".length), secret);
    } catch (error) {
      next(error);
      return;
    }
    next();
  };
}
