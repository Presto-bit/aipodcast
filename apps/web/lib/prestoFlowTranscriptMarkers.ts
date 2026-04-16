/** 稿面词块旁：LLM/规则建议的快捷应用与撤销 */
export type TranscriptWordSuggestionMarker = {
  status: "pending" | "applied";
  applyLabel: string;
  undoLabel: string;
  onApply: () => void;
  onUndo: () => void;
  /** 与侧栏同条建议：悬停卡片标题 */
  suggestionTitle: string;
  /** 与侧栏同条建议：悬停卡片说明 */
  suggestionBody: string;
  /** 悬停卡片内「操作」小标题 */
  actionsHeading: string;
};
