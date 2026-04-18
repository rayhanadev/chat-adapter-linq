import type { EmojiValue } from "chat";
import type { LinqReactionType } from "./types.js";

const TAPBACK_EMOJI: Record<LinqReactionType, string | null> = {
  love: "\u2764\ufe0f",
  like: "\ud83d\udc4d",
  dislike: "\ud83d\udc4e",
  laugh: "\ud83d\ude02",
  emphasize: "\u203c\ufe0f",
  question: "\u2753",
  custom: null,
};

const NAME_TO_REACTION: Record<string, LinqReactionType> = {
  heart: "love",
  love: "love",
  red_heart: "love",
  thumbs_up: "like",
  "+1": "like",
  thumbs_down: "dislike",
  "-1": "dislike",
  laugh: "laugh",
  joy: "laugh",
  smile: "laugh",
  rofl: "laugh",
  exclamation: "emphasize",
  bangbang: "emphasize",
  emphasize: "emphasize",
  question: "question",
};

const RAW_TO_REACTION: Record<string, LinqReactionType> = {
  "\u2764\ufe0f": "love",
  "\u2764": "love",
  "\u2665": "love",
  "\ud83d\udc4d": "like",
  "\ud83d\udc4e": "dislike",
  "\ud83d\ude02": "laugh",
  "\ud83e\udd23": "laugh",
  "\u203c\ufe0f": "emphasize",
  "\u203c": "emphasize",
  "!": "emphasize",
  "!!": "emphasize",
  "\u2753": "question",
  "?": "question",
};

export interface MappedReaction {
  type: LinqReactionType;
  custom_emoji?: string;
}

export function emojiToReaction(emoji: EmojiValue | string): MappedReaction {
  if (typeof emoji === "string") {
    const normalized = emoji.trim();
    const raw = RAW_TO_REACTION[normalized];
    if (raw) return { type: raw };
    const named = NAME_TO_REACTION[normalized.toLowerCase()];
    if (named) return { type: named };
    return { type: "custom", custom_emoji: normalized };
  }

  const named = NAME_TO_REACTION[emoji.name.toLowerCase()];
  if (named) return { type: named };
  return { type: "custom", custom_emoji: emoji.name };
}

export function reactionToEmoji(type: LinqReactionType, customEmoji?: string | null): string {
  if (type === "custom") return customEmoji ?? "";
  return TAPBACK_EMOJI[type] ?? "";
}
