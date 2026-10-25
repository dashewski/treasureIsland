import { calcSettlement } from "./calcSettlement";
import type { Match, MoveResult, Reveal } from "../types/match";

// stake 5: big chest 4, small chest 1
function endedMatch(
  p1: [MoveResult, MoveResult],
  p2: [MoveResult, MoveResult],
  amounts = { bid: "5", bigAmount: "4", smallAmount: "1" },
): Pick<Match, "status" | "bid" | "bigAmount" | "smallAmount" | "reveal"> {
  const reveal: Reveal = {
    p1_move_1_result: p1[0],
    p1_move_2_result: p1[1],
    p2_move_1_result: p2[0],
    p2_move_2_result: p2[1],
  };
  return { status: "ended", ...amounts, reveal };
}

describe("calcSettlement", () => {
  it("player 1 finds the small chest, player 2 finds nothing", () => {
    const s = calcSettlement(endedMatch(["hit_small", "miss"], ["miss", "miss"]));
    expect(s.p1).toEqual({ found: 100, kept: 500, result: 600, profit: 100, fee: 10, payout: 590 });
    expect(s.p2).toEqual({ found: 0, kept: 400, result: 400, profit: -100, fee: 0, payout: 400 });
    expect(s.totalFee).toBe(10);
  });

  it("player 1 finds the big chest, player 2 finds nothing", () => {
    const s = calcSettlement(endedMatch(["hit_big", "miss"], ["miss", "miss"]));
    expect(s.p1.result).toBe(900);
    expect(s.p1.fee).toBe(40);
    expect(s.p1.payout).toBe(860);
    expect(s.p2.result).toBe(100);
    expect(s.p2.payout).toBe(100);
  });

  it("player 1 finds the big chest, player 2 finds the small one", () => {
    const s = calcSettlement(endedMatch(["hit_big", "miss"], ["hit_small", "miss"]));
    expect(s.p1.result).toBe(800);
    expect(s.p1.fee).toBe(30);
    expect(s.p1.payout).toBe(770);
    expect(s.p2.result).toBe(200);
    expect(s.p2.payout).toBe(200);
    expect(s.totalFee).toBe(30);
  });

  it("no fee when both find everything", () => {
    const s = calcSettlement(endedMatch(["hit_big", "hit_small"], ["hit_big", "hit_small"]));
    expect(s.p1.result).toBe(500);
    expect(s.p2.result).toBe(500);
    expect(s.totalFee).toBe(0);
  });

  it("no fee when both find nothing", () => {
    const s = calcSettlement(endedMatch(["miss", "miss"], ["miss", "miss"]));
    expect(s.p1.payout).toBe(500);
    expect(s.p2.payout).toBe(500);
    expect(s.totalFee).toBe(0);
  });

  it("a skipped move finds nothing", () => {
    const s = calcSettlement(endedMatch(["skipped", "skipped"], ["hit_big", "hit_small"]));
    expect(s.p1).toEqual({ found: 0, kept: 0, result: 0, profit: -500, fee: 0, payout: 0 });
    expect(s.p2.result).toBe(1000);
    expect(s.p2.fee).toBe(50);
    expect(s.p2.payout).toBe(950);
  });

  it("rounds the fee down to the cent", () => {
    // profit is 9 cents, 10% is 0.9 cent
    const s = calcSettlement(
      endedMatch(["hit_small", "miss"], ["miss", "miss"], {
        bid: "0.45",
        bigAmount: "0.36",
        smallAmount: "0.09",
      }),
    );
    expect(s.p1.profit).toBe(9);
    expect(s.p1.fee).toBe(0);
    expect(s.p1.payout).toBe(54);
  });

  it("results always add up to two bids", () => {
    const outcomes: MoveResult[] = ["hit_big", "hit_small", "miss", "skipped"];
    for (const a of outcomes) {
      for (const b of outcomes) {
        for (const c of outcomes) {
          for (const d of outcomes) {
            const s = calcSettlement(endedMatch([a, b], [c, d]));
            expect(s.p1.result + s.p2.result).toBe(1000);
            expect(s.p1.payout + s.p2.payout + s.totalFee).toBe(1000);
          }
        }
      }
    }
  });

  it("rejects a match that is not ended", () => {
    const match = { ...endedMatch(["miss", "miss"], ["miss", "miss"]), status: "reveal" as const };
    expect(() => calcSettlement(match)).toThrow("match not ended");
  });

  it("rejects a match without reveal data", () => {
    const match = { ...endedMatch(["miss", "miss"], ["miss", "miss"]), reveal: null };
    expect(() => calcSettlement(match)).toThrow("reveal data is missing");
  });

  it("rejects a match with a missing move result", () => {
    const match = endedMatch(["miss", "miss"], ["miss", "miss"]);
    delete match.reveal?.p2_move_2_result;
    expect(() => calcSettlement(match)).toThrow("missing result of p2 move 2");
  });

  it("rejects chest amounts that do not add up to the bid", () => {
    const match = endedMatch(["miss", "miss"], ["miss", "miss"], {
      bid: "5",
      bigAmount: "4",
      smallAmount: "2",
    });
    expect(() => calcSettlement(match)).toThrow("chest amounts do not add up to the bid");
  });
});
