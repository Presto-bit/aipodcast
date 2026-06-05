import type { StudioAgentTurn } from "./studioWorkTypes";

export type StudioDialogueTurnGroup = {
  id: string;
  userTurn: StudioAgentTurn;
  assistantTurns: StudioAgentTurn[];
};

/** 用户句 + 其后助手回复 → 一轮对话组 */
export function buildStudioDialogueTurnGroups(turns: StudioAgentTurn[]): StudioDialogueTurnGroup[] {
  const groups: StudioDialogueTurnGroup[] = [];
  let current: StudioDialogueTurnGroup | null = null;

  for (const turn of turns) {
    if (turn.role === "user") {
      if (current) groups.push(current);
      current = { id: turn.id, userTurn: turn, assistantTurns: [] };
      continue;
    }
    if (current) {
      current.assistantTurns.push(turn);
    }
  }
  if (current) groups.push(current);
  return groups;
}

export function splitActiveDialogueGroups(groups: StudioDialogueTurnGroup[]): {
  history: StudioDialogueTurnGroup[];
  active: StudioDialogueTurnGroup | null;
} {
  if (!groups.length) return { history: [], active: null };
  return { history: groups.slice(0, -1), active: groups[groups.length - 1] ?? null };
}

/** 历史组较多时启用虚拟列表 */
export function shouldVirtualizeDialogueHistory(historyCount: number): boolean {
  return historyCount >= 8;
}
