"use client";

import type { ReactNode, RefObject } from "react";
import { buildStudioTimeline } from "../../lib/studioTimeline";
import type { StudioComposePreview } from "../../lib/studioComposePreview";
import type { ManuscriptBlock, StudioAgentTurn, StudioWork } from "../../lib/studioWorkTypes";
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
  composePreview = null,
  onAdoptComposePreview,
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
  composePreview?: StudioComposePreview | null;
  onAdoptComposePreview?: () => void;
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
              onTitleIndexChange={onTitleIndexChange}
              onBlocksChange={onBlocksChange}
              streamingBlocks={streamingBlocks}
              streamingBodyText={streamingBodyText}
              composePreview={composePreview}
              onAdoptComposePreview={onAdoptComposePreview}
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
