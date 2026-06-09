"use client";

import type { ReactNode, RefObject } from "react";
import { buildStudioTimeline } from "../../lib/studioTimeline";
import type { ManuscriptBlock, PendingPatch, StudioAgentTurn, StudioWork } from "../../lib/studioWorkTypes";
import StudioTimelineManuscriptCard from "./StudioTimelineManuscriptCard";
import StudioAgentMessage from "./StudioAgentMessage";
import StudioEphemeralHint from "./StudioEphemeralHint";

export default function StudioTimelinePanel({
  work,
  turns,
  streamingPhase,
  scrollRef,
  canEdit,
  onEditUserTurn,
  emptyHint,
  busy,
  hideManuscript,
  onSuggestedReply,
  onTitleIndexChange,
  onBlocksChange,
  showFeatureNudge,
  onFillFeature,
  onDismissFeatureNudge,
  streamingBlocks = null,
  streamingBodyText = null,
  streamOptimizing = false,
  canvasRouteHint = "",
  pendingPatch = null,
  patchSelections = new Set<string>(),
  onApplyPatch,
  onDiscardPatch,
  onTogglePatchKey,
  onUndo,
  onRetryError,
  onCorpusMenuOpen,
  selectionHighlight,
  onTextSelect,
  activeAgentStatus = null
}: {
  work: StudioWork;
  turns: StudioAgentTurn[];
  streamingPhase?: string;
  scrollRef: RefObject<HTMLDivElement>;
  canEdit?: boolean;
  onEditUserTurn?: (turnId: string, newText: string) => void;
  onSuggestedReply?: (text: string) => void;
  emptyHint?: string;
  busy: boolean;
  hideManuscript?: boolean;
  onTitleIndexChange?: (index: number) => void;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  showFeatureNudge: boolean;
  onFillFeature: () => void;
  onDismissFeatureNudge: () => void;
  streamingBlocks?: ManuscriptBlock[] | null;
  streamingBodyText?: string | null;
  streamOptimizing?: boolean;
  canvasRouteHint?: string;
  pendingPatch?: PendingPatch | null;
  patchSelections?: Set<string>;
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  onTogglePatchKey?: (key: string) => void;
  onUndo?: () => void;
  onRetryError?: () => void;
  onCorpusMenuOpen?: () => void;
  selectionHighlight?: string;
  onTextSelect?: (text: string) => void;
  activeAgentStatus?: ReactNode;
}) {
  void scrollRef;
  const items = buildStudioTimeline(work, turns, { hideManuscript: hideManuscript });

  return (
    <div className="px-0.5 text-left">
      {!turns.length && emptyHint ? (
        <p className="py-6 text-center text-sm text-muted">{emptyHint}</p>
      ) : null}

      <div className="space-y-5">
        {items.map((item) => {
          if (item.kind === "dialogue") {
            const isUser = item.turn.role === "user";
            return (
              <div key={`dlg-${item.turn.id}`} data-studio-turn-group={isUser ? item.groupId : undefined}>
                {item.ephemeral ? (
                  <StudioEphemeralHint text={item.turn.content} ttlMs={4000} />
                ) : (
                  <StudioAgentMessage
                    turn={item.turn}
                    userAnchor={isUser ? item.userAnchor : undefined}
                    streamingPhase={item.turn.streaming ? streamingPhase : undefined}
                    canEdit={isUser ? canEdit : undefined}
                    onEditUserTurn={isUser ? onEditUserTurn : undefined}
                    onSuggestedReply={!isUser ? onSuggestedReply : undefined}
                  />
                )}
                {isUser && item.isActive && activeAgentStatus ? (
                  <div className="mt-2">{activeAgentStatus}</div>
                ) : null}
              </div>
            );
          }

          return (
            <StudioTimelineManuscriptCard
              key={`ms-${item.run.id}`}
              work={work}
              run={item.run}
              version={item.version}
              baseVersion={item.baseVersion}
              isActiveVersion={item.isActiveVersion}
              busy={busy}
              streamingBlocks={streamingBlocks}
              streamingBodyText={streamingBodyText}
              streamOptimizing={streamOptimizing}
              canvasRouteHint={canvasRouteHint}
              pendingPatch={item.pendingPatch ?? (pendingPatch?.sourceRunId === item.run.id ? pendingPatch : null)}
              patchSelections={patchSelections}
              onApplyPatch={onApplyPatch}
              onDiscardPatch={onDiscardPatch}
              onTogglePatchKey={onTogglePatchKey}
              onRetryError={onRetryError}
              onCorpusMenuOpen={onCorpusMenuOpen}
              selectionHighlight={selectionHighlight}
              onTextSelect={onTextSelect}
            />
          );
        })}
      </div>

      {showFeatureNudge ? (
        <p className="mt-6 text-[11px] text-muted">
          下一篇想更像自己，可去对话页填写「我的特色」。
          <button type="button" className="ml-1 text-brand underline" onClick={onFillFeature}>
            去填写
          </button>
          <button type="button" className="ml-2 text-muted underline" onClick={onDismissFeatureNudge}>
            暂不
          </button>
        </p>
      ) : null}
    </div>
  );
}
