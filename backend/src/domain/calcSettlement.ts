import { FEE_PERCENT } from "../constants";
import type { Match, MoveNumber, MoveResult, PlayerSlot } from "../types/match";
import { decimalToCents } from "./money";

// All amounts are in cents.
export interface PlayerSettlement {
  found: number;
  kept: number;
  result: number;
  profit: number; // before the fee
  fee: number;
  payout: number;
}

export interface Settlement {
  p1: PlayerSettlement;
  p2: PlayerSettlement;
  totalFee: number;
}

type SettlementInput = Pick<Match, "status" | "bid" | "bigAmount" | "smallAmount" | "reveal">;

const MOVES: readonly MoveNumber[] = [1, 2];

export function calcSettlement(match: SettlementInput): Settlement {
  if (match.status !== "ended") {
    throw new Error("match not ended");
  }
  const reveal = match.reveal;
  if (reveal === null) {
    throw new Error("reveal data is missing");
  }

  const bidC = decimalToCents(match.bid);
  const bigC = decimalToCents(match.bigAmount);
  const smallC = decimalToCents(match.smallAmount);
  if (bigC + smallC !== bidC) {
    throw new Error("chest amounts do not add up to the bid");
  }

  const worth: Record<MoveResult, number> = {
    hit_big: bigC,
    hit_small: smallC,
    miss: 0,
    skipped: 0,
  };

  function foundBy(slot: PlayerSlot): number {
    let sum = 0;
    for (const n of MOVES) {
      const moveResult = reveal?.[`${slot}_move_${n}_result`];
      if (moveResult === undefined) {
        throw new Error(`missing result of ${slot} move ${n}`);
      }
      sum += worth[moveResult];
    }
    return sum;
  }

  function settle(found: number, opponentFound: number): PlayerSettlement {
    const kept = bidC - opponentFound;
    const result = found + kept;
    const profit = result - bidC;
    // rounded down to the cent, in the player's favour
    const fee = profit > 0 ? Math.floor((profit * FEE_PERCENT) / 100) : 0;
    return { found, kept, result, profit, fee, payout: result - fee };
  }

  const foundP1 = foundBy("p1");
  const foundP2 = foundBy("p2");
  const p1 = settle(foundP1, foundP2);
  const p2 = settle(foundP2, foundP1);

  if (p1.result + p2.result !== 2 * bidC) {
    throw new Error("results do not add up to two bids");
  }

  return { p1, p2, totalFee: p1.fee + p2.fee };
}
