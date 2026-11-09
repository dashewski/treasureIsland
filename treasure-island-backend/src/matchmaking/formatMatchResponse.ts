import { calcSettlement } from "../domain/calcSettlement";
import { centsToDecimalString, decimalToCents } from "../domain/money";
import { ForbiddenError } from "../errors";
import type { Match, MatchStatus, MoveNumber, MoveResult, PlayerSlot } from "../types/match";

const MOVES: readonly MoveNumber[] = [1, 2];

export interface ChestsView {
  big: number | null;
  small: number | null;
}

export interface MoveView {
  zone: number | "skipped";
  result: MoveResult;
}

// what the frontend may see; amounts are decimal strings, times are milliseconds
export interface MatchResponse {
  matchId: string;
  status: MatchStatus;
  bid: string;
  createdAt: number;
  stateVersion: number;
  placementDeadline?: number;
  turnDeadline?: number;
  currentTurn?: string;
  myPlacement?: ChestsView;
  opponentPlaced?: { big: boolean; small: boolean };
  myMoves?: MoveView[];
  opponentMoves?: MoveView[];
  opponentPlacement?: ChestsView;
  settlement?: { result: string; netProfit: string; fee: string; payout: string };
  cancelReason?: string;
}

function slotOf(match: Match, playerId: string): PlayerSlot {
  if (match.player1 === playerId) return "p1";
  if (match.player2 === playerId) return "p2";
  throw new ForbiddenError("not a participant");
}

function chestsOf(match: Match, slot: PlayerSlot): ChestsView {
  return {
    big: match.placement?.[`${slot}_big`] ?? null,
    small: match.placement?.[`${slot}_small`] ?? null,
  };
}

function movesOf(match: Match, slot: PlayerSlot): MoveView[] {
  const moves: MoveView[] = [];
  for (const n of MOVES) {
    const zone = match.reveal?.[`${slot}_move_${n}_zone`];
    const result = match.reveal?.[`${slot}_move_${n}_result`];
    if (zone !== undefined && result !== undefined) moves.push({ zone, result });
  }
  return moves;
}

// the only way a raw match reaches the frontend: no hold ids, no chests of the opponent
// before the match has ended
export function formatMatchResponse(match: Match, requestingPlayerId: string): MatchResponse {
  const mySlot = slotOf(match, requestingPlayerId);
  const opponentSlot: PlayerSlot = mySlot === "p1" ? "p2" : "p1";

  const response: MatchResponse = {
    matchId: match.matchId,
    status: match.status,
    bid: centsToDecimalString(decimalToCents(match.bid)),
    createdAt: match.createdAt,
    stateVersion: match.stateVersion,
  };

  if (match.status === "placement") {
    if (match.placementDeadline !== null) response.placementDeadline = match.placementDeadline;
    response.myPlacement = chestsOf(match, mySlot);
    const opponent = chestsOf(match, opponentSlot);
    response.opponentPlaced = { big: opponent.big !== null, small: opponent.small !== null };
  }

  if (match.status === "reveal" || match.status === "ended") {
    response.myPlacement = chestsOf(match, mySlot);
    response.myMoves = movesOf(match, mySlot);
    response.opponentMoves = movesOf(match, opponentSlot);
  }

  if (match.status === "reveal") {
    if (match.turnDeadline !== null) response.turnDeadline = match.turnDeadline;
    if (match.currentTurn !== null) response.currentTurn = match.currentTurn;
  }

  if (match.status === "ended") {
    response.opponentPlacement = chestsOf(match, opponentSlot);
    const mine = calcSettlement(match)[mySlot];
    response.settlement = {
      result: centsToDecimalString(mine.result),
      netProfit: centsToDecimalString(mine.payout - decimalToCents(match.bid)),
      fee: centsToDecimalString(mine.fee),
      payout: centsToDecimalString(mine.payout),
    };
  }

  if (match.status === "cancelled" && match.cancelReason !== null) {
    response.cancelReason = match.cancelReason;
  }

  return response;
}
