export type MatchStatus = "waiting" | "placement" | "reveal" | "ended" | "cancelled";

export type PlayerSlot = "p1" | "p2";
export type ChestType = "big" | "small";
export type MoveNumber = 1 | 2;
export type MoveResult = "hit_big" | "hit_small" | "miss" | "skipped";

export type Placement = Partial<Record<`${PlayerSlot}_${ChestType}`, number>>;

export type Reveal = Partial<
  Record<`${PlayerSlot}_move_${MoveNumber}_zone`, number | "skipped"> &
    Record<`${PlayerSlot}_move_${MoveNumber}_result`, MoveResult>
>;

// Redis stores everything as strings, loadMatch converts them to these types.
export interface Match {
  matchId: string;
  status: MatchStatus;

  player1: string;
  player2: string | null;

  player1HoldId: string;
  player2HoldId: string | null;

  bid: string;
  bigAmount: string;
  smallAmount: string;

  createdAt: number;
  updatedAt: number;

  placementDeadline: number | null;
  turnDeadline: number | null;
  currentTurn: string | null;

  cancelReason: string | null;

  stateVersion: number;

  placement: Placement | null;
  reveal: Reveal | null;
}
