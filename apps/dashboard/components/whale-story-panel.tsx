"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { formatStoryTimestamp } from "@/lib/story-time";
import type { WhaleStory } from "@/lib/types";
import styles from "./whale-story-detail-modal.module.css";

const loadWhaleStoryDetailModal = () =>
  import("./whale-story-detail-modal").then((mod) => mod.WhaleStoryDetailModal);

const WhaleStoryDetailModal = dynamic(loadWhaleStoryDetailModal, {
  ssr: false,
  loading: () => null,
});

type WhaleStoryPanelProps = {
  stories: readonly WhaleStory[];
  emptyMessage?: string;
  generatedPrefix?: string;
};

function truncateHash(value?: string): string {
  if (!value) {
    return "해시 없음";
  }
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function WhaleStoryPanel({
  stories,
  emptyMessage = "표시할 고래 스토리가 없습니다.",
  generatedPrefix = "생성",
}: WhaleStoryPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedStory = stories.find((story) => story.id === selectedId) ?? null;
  const visibleStories = stories.slice(0, 4);

  useEffect(() => {
    if (typeof window === "undefined" || stories.length === 0) return;
    const schedule =
      (window as typeof window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1500));
    const handle = schedule(() => {
      loadWhaleStoryDetailModal().catch(() => undefined);
    });
    return () => {
      const cancel =
        (window as typeof window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback ??
        window.clearTimeout;
      cancel(handle as number);
    };
  }, [stories.length]);

  if (stories.length === 0) {
    return <p className={styles.emptyState}>{emptyMessage}</p>;
  }

  return (
    <>
      <div className={styles.panel}>
        {visibleStories.map((story) => {
          const hasBadgeRow = Boolean(story.observationLabel || story.partialView);
          const meta = [
            story.meta,
            story.generatedAt ? `${generatedPrefix} ${formatStoryTimestamp(story.generatedAt)}` : "",
            story.hash ? truncateHash(story.hash) : "",
          ].filter(Boolean);

          return (
            <button
              key={story.id}
              type="button"
              className={styles.storyButton}
              onClick={() => setSelectedId(story.id)}
              onPointerEnter={() => loadWhaleStoryDetailModal().catch(() => undefined)}
              onFocus={() => loadWhaleStoryDetailModal().catch(() => undefined)}
              onTouchStart={() => loadWhaleStoryDetailModal().catch(() => undefined)}
            >
              <div className={styles.storyCard}>
                <div className={styles.storyDot} data-tone={story.tone} />
                <div className={styles.storyCopy}>
                  {hasBadgeRow ? (
                    <div className={styles.observationBadgeRow}>
                      {story.observationLabel ? (
                        <span className={styles.observationBadge}>{story.observationLabel}</span>
                      ) : null}
                      {story.partialView ? (
                        <span
                          aria-label={`${story.partialView.badge}: ${story.partialView.tooltip}`}
                          className={styles.observationBadge}
                          data-variant="partial"
                          title={story.partialView.tooltip}
                        >
                          {story.partialView.badge}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <h4 className={styles.storyTitle}>{story.title}</h4>
                  <p className={styles.storyBody}>{story.body}</p>
                  {story.partialView ? (
                    <p className={styles.storyScopeNote}>{story.partialView.cardSummary}</p>
                  ) : null}
                  <div className={styles.storyMeta}>
                    {meta.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>
                <span className={`${styles.storyAction} material-symbols-outlined`} aria-hidden="true">
                  open_in_full
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <WhaleStoryDetailModal
        story={selectedStory}
        isOpen={selectedStory != null}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
