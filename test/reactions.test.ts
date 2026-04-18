import { describe, expect, it } from "vitest";
import { getEmoji } from "chat";
import { emojiToReaction, reactionToEmoji } from "../src/reactions.js";

describe("emojiToReaction", () => {
  it("maps EmojiValue and unicode to Linq tapback types", () => {
    expect(emojiToReaction(getEmoji("heart"))).toEqual({ type: "love" });
    expect(emojiToReaction(getEmoji("thumbs_up"))).toEqual({ type: "like" });
    expect(emojiToReaction("\u2764\ufe0f")).toEqual({ type: "love" });
    expect(emojiToReaction("\ud83d\udc4d")).toEqual({ type: "like" });
  });

  it("falls back to custom for unknown emoji", () => {
    expect(emojiToReaction("\ud83d\ude80")).toEqual({
      type: "custom",
      custom_emoji: "\ud83d\ude80",
    });
    expect(emojiToReaction(getEmoji("rocket"))).toEqual({ type: "custom", custom_emoji: "rocket" });
  });
});

describe("reactionToEmoji", () => {
  it("returns canonical unicode for tapbacks and custom emoji", () => {
    expect(reactionToEmoji("love")).toBe("\u2764\ufe0f");
    expect(reactionToEmoji("custom", "\ud83c\udf89")).toBe("\ud83c\udf89");
  });
});
