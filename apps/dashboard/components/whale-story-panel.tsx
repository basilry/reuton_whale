"use client";

import { useState } from "react";

import { formatStoryTimestamp } from "@/lib/story-time";
import type { WhaleStory } from "@/lib/types";
import { WhaleStoryDetailModal } from "./whale-story-detail-modal";
import styles from "./whale-story-detail-modal.module.css";

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

  if (stories.length === 0) {
    return <p className={styles.emptyState}>{emptyMessage}</p>;
  }

  return (
    <>
      <div className={styles.panel}>
        {stories.map((story) => {
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
            >
              <div className={styles.storyCard}>
                <div className={styles.storyDot} data-tone={story.tone} />
                <div className={styles.storyCopy}>
                  <h4 className={styles.storyTitle}>{story.title}</h4>
                  <p className={styles.storyBody}>{story.body}</p>
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
