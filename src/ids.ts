import { ValidationError } from "@chat-adapter/shared";
import { ADAPTER_NAME } from "./types.js";

/**
 * Decoded representation of a Linq thread ID.
 *
 * Wire format:
 * - DM chat:    `linq:c:base64url(from):base64url(chatId)`
 * - Group chat: `linq:g:base64url(from):base64url(chatId)`
 * - Pending DM: `linq:p:base64url(from):base64url(recipient)` — used by `openDM`
 *   when no Linq chat exists yet; the chat is created on first `post()`.
 */
export type LinqThreadId =
  | { kind: "chat"; from: string; chatId: string; isGroup: boolean }
  | { kind: "pending"; from: string; recipient: string };

const PREFIX = ADAPTER_NAME;

function encodeSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeSegment(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function encodeThreadId(data: LinqThreadId): string {
  if (data.kind === "pending") {
    return `${PREFIX}:p:${encodeSegment(data.from)}:${encodeSegment(data.recipient)}`;
  }
  const tag = data.isGroup ? "g" : "c";
  return `${PREFIX}:${tag}:${encodeSegment(data.from)}:${encodeSegment(data.chatId)}`;
}

export function decodeThreadId(threadId: string): LinqThreadId {
  const parts = threadId.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new ValidationError(ADAPTER_NAME, `Invalid Linq thread ID: ${threadId}`);
  }
  const tag = parts[1];
  const fromSeg = parts[2];
  const tail = parts[3];
  if (!tag || !fromSeg || !tail) {
    throw new ValidationError(ADAPTER_NAME, `Invalid Linq thread ID: ${threadId}`);
  }

  const from = safeDecode(fromSeg, threadId);

  switch (tag) {
    case "c":
      return { kind: "chat", from, chatId: safeDecode(tail, threadId), isGroup: false };
    case "g":
      return { kind: "chat", from, chatId: safeDecode(tail, threadId), isGroup: true };
    case "p":
      return { kind: "pending", from, recipient: safeDecode(tail, threadId) };
    default:
      throw new ValidationError(ADAPTER_NAME, `Unknown Linq thread tag '${tag}': ${threadId}`);
  }
}

function safeDecode(segment: string, threadId: string): string {
  try {
    const decoded = decodeSegment(segment);
    if (!decoded) {
      throw new ValidationError(ADAPTER_NAME, `Empty segment in thread ID: ${threadId}`);
    }
    return decoded;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(ADAPTER_NAME, `Failed to decode thread ID segment: ${threadId}`);
  }
}

/** Channel ID is just the thread ID itself — Linq has no separate channel container. */
export function channelIdFromThreadId(threadId: string): string {
  // Round-trip through decode/encode to validate.
  return encodeThreadId(decodeThreadId(threadId));
}
