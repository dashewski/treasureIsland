import jwt from "jsonwebtoken";
import { JWT_TTL } from "../constants";
import { AuthError } from "../errors";

export function issueJWT(playerId: number, secret: string): string {
  return jwt.sign({ sub: String(playerId) }, secret, { algorithm: "HS256", expiresIn: JWT_TTL });
}

// returns the playerId (a string, as in sub); anything wrong with the token is an AuthError
export function verifyJWT(token: string, secret: string): string {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    throw new AuthError("invalid token");
  }
  if (typeof payload === "string" || typeof payload.sub !== "string" || !/^[1-9][0-9]*$/.test(payload.sub)) {
    throw new AuthError("invalid token");
  }
  return payload.sub;
}
