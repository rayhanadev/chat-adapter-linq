import { describe, expect, it } from "vitest";
import { ValidationError } from "@chat-adapter/shared";
import { channelIdFromThreadId, decodeThreadId, encodeThreadId } from "../src/ids.js";

describe("thread IDs", () => {
  it("round-trips a DM chat thread ID", () => {
    const id = encodeThreadId({
      kind: "chat",
      from: "+12025551234",
      chatId: "0c961e93-e7bf-4db2-bf7b-ea06826bcab4",
      isGroup: false,
    });
    expect(id.startsWith("linq:c:")).toBe(true);
    expect(decodeThreadId(id)).toEqual({
      kind: "chat",
      from: "+12025551234",
      chatId: "0c961e93-e7bf-4db2-bf7b-ea06826bcab4",
      isGroup: false,
    });
  });

  it("round-trips a group chat thread ID", () => {
    const id = encodeThreadId({
      kind: "chat",
      from: "+12025551234",
      chatId: "group-id",
      isGroup: true,
    });
    expect(id.startsWith("linq:g:")).toBe(true);
    expect(decodeThreadId(id).kind).toBe("chat");
  });

  it("round-trips a pending thread ID", () => {
    const id = encodeThreadId({
      kind: "pending",
      from: "+12025551234",
      recipient: "user@example.com",
    });
    expect(id.startsWith("linq:p:")).toBe(true);
    expect(decodeThreadId(id)).toEqual({
      kind: "pending",
      from: "+12025551234",
      recipient: "user@example.com",
    });
  });

  it("rejects malformed thread IDs", () => {
    expect(() => decodeThreadId("slack:c:abc:def")).toThrow(ValidationError);
    expect(() => decodeThreadId("linq:c:abc")).toThrow(ValidationError);
    expect(() => decodeThreadId("linq:x:abc:def")).toThrow(ValidationError);
  });

  it("returns the thread ID itself as the channel ID", () => {
    const id = encodeThreadId({ kind: "chat", from: "+1", chatId: "x", isGroup: false });
    expect(channelIdFromThreadId(id)).toBe(id);
  });
});
