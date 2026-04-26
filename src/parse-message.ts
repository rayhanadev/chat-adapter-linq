import { Message, paragraph, root, text } from "chat";
import type { Attachment, Author, MessageData } from "chat";
import type { Root } from "mdast";
import { LinqFormatConverter } from "./format-converter.js";
import { encodeThreadId } from "./ids.js";
import type {
  LinqHandle,
  LinqMessage,
  LinqMessageEditedEventDataV2,
  LinqMessageEventDataV2,
  LinqMessagePart,
} from "./types.js";

const converter = new LinqFormatConverter();

export interface ParseMessageContext {
  /** The bot's phone number (the "from" line that received this event). */
  botFrom: string;
}

export function parseMessageEvent(
  data: LinqMessageEventDataV2,
  ctx: ParseMessageContext,
): Message<LinqMessageEventDataV2> {
  const threadId = encodeThreadId({
    kind: "chat",
    from: ctx.botFrom,
    chatId: data.chat.id,
    isGroup: data.chat.is_group,
  });
  const isMe = data.sender_handle.is_me || data.direction === "outbound";

  const textValue = partsToText(data.parts);
  const formatted = textValue ? converter.toAst(textValue) : emptyRoot();

  const messageData: MessageData<LinqMessageEventDataV2> = {
    id: data.id,
    threadId,
    text: textValue,
    formatted,
    raw: data,
    author: handleToAuthor(data.sender_handle, isMe),
    metadata: {
      dateSent: parseDate(data.sent_at) ?? new Date(),
      edited: false,
    },
    attachments: partsToAttachments(data.parts),
  };

  return new Message<LinqMessageEventDataV2>(messageData);
}

export function parseEditedMessageEvent(
  data: LinqMessageEditedEventDataV2,
  ctx: ParseMessageContext,
): Message<LinqMessageEditedEventDataV2> {
  const threadId = encodeThreadId({
    kind: "chat",
    from: ctx.botFrom,
    chatId: data.chat.id,
    isGroup: data.chat.is_group,
  });
  const isMe = data.sender_handle.is_me || data.direction === "outbound";
  const textValue = data.part.text ?? "";
  const formatted = textValue ? converter.toAst(textValue) : emptyRoot();

  const messageData: MessageData<LinqMessageEditedEventDataV2> = {
    id: data.id,
    threadId,
    text: textValue,
    formatted,
    raw: data,
    author: handleToAuthor(data.sender_handle, isMe),
    metadata: {
      dateSent: parseDate(data.edited_at) ?? new Date(),
      edited: true,
      editedAt: parseDate(data.edited_at) ?? new Date(),
    },
    attachments: [],
  };

  return new Message<LinqMessageEditedEventDataV2>(messageData);
}

export function handleToAuthor(handle: LinqHandle, isMe: boolean): Author {
  return {
    userId: handle.handle,
    userName: handle.handle,
    fullName: handle.handle,
    isBot: isMe ? true : "unknown",
    isMe,
  };
}

/**
 * True when a Linq message is a tombstone — a deleted message or a system
 * event (participant join/leave, name change, etc.). Linq signals these by
 * returning `parts: null`; the adapter preserves the row so pagination
 * stays consistent, and consumers can use this to decide how to render
 * (skip, show "[deleted]", etc.).
 */
export function isLinqTombstone(message: Pick<LinqMessage, "parts">): boolean {
  return !Array.isArray(message.parts);
}

export function partsToText(parts: LinqMessagePart[] | null | undefined): string {
  // `parts` may be null on tombstones / system events — see LinqMessage.parts.
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (p): p is LinqMessagePart & { type: "text"; value: string } =>
        Boolean(p) && p.type === "text" && typeof (p as { value?: unknown }).value === "string",
    )
    .map((p) => p.value)
    .join("\n")
    .trim();
}

export function partsToAttachments(parts: LinqMessagePart[] | null | undefined): Attachment[] {
  const attachments: Attachment[] = [];
  if (!Array.isArray(parts)) return attachments;
  for (const part of parts) {
    if (!part) continue;
    if (part.type === "media" || part.type === "voice_memo") {
      const mime = "mime_type" in part ? part.mime_type : undefined;
      const attachment: Attachment = {
        type: classifyAttachment(mime),
        name: "filename" in part ? part.filename : undefined,
        mimeType: mime,
        size: "size_bytes" in part ? part.size_bytes : undefined,
        url: part.url,
      };
      if (part.url) {
        const downloadUrl = part.url;
        attachment.fetchData = async () => {
          const res = await fetch(downloadUrl);
          if (!res.ok) {
            throw new Error(`Failed to fetch attachment ${downloadUrl}: ${res.status}`);
          }
          const buf = await res.arrayBuffer();
          return Buffer.from(buf);
        };
      }
      attachments.push(attachment);
    }
  }
  return attachments;
}

function classifyAttachment(mime: string | undefined): Attachment["type"] {
  if (!mime) return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function emptyRoot(): Root {
  return root([paragraph([text("")])]);
}
