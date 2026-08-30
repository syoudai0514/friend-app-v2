import type { AppState, ModelTurn } from "./types";

const MAX_MEMORIES = 40;

/**
 * turn_complete 後の唯一の persistent state transition。
 * draft / retry / preview はこの関数へ到達させない。
 */
export function applyConversationTransaction(
  state: AppState,
  turn: ModelTurn,
  at: number = Date.now(),
): AppState {
  const learned = turn.memory?.trim();
  const memories = learned
    ? [...state.memories.filter((memory) => memory !== learned), learned].slice(-MAX_MEMORIES)
    : state.memories;

  return {
    ...state,
    messages: [
      ...state.messages,
      {
        role: "model",
        text: turn.speech,
        at,
        ...(turn.narration ? { narration: turn.narration } : {}),
        performance: turn.performance,
      },
    ],
    memories,
    affection: state.affection + 1,
  };
}

/**
 * retry / duplicate turn_complete を session 内で二重 commit させない。
 * reload 時は in-flight request 自体が消えるため、この ledger は永続化しない。
 */
export class ConversationTransactionLedger {
  private readonly committed = new Set<string>();

  accept(turnId: string): boolean {
    if (!turnId || this.committed.has(turnId)) return false;
    this.committed.add(turnId);
    return true;
  }

  release(turnId: string): void {
    this.committed.delete(turnId);
  }

  has(turnId: string): boolean {
    return this.committed.has(turnId);
  }

  clear(): void {
    this.committed.clear();
  }
}
