import { cardToFallbackText, extractCard, extractFiles } from "@chat-adapter/shared";
import type { AdapterPostableMessage } from "chat";
import { uploadFile } from "./attachments.js";
import type { LinqClient } from "./client.js";
import { LinqFormatConverter } from "./format-converter.js";
import type { LinqMediaPart, LinqMessagePart } from "./types.js";

const converter = new LinqFormatConverter();

export async function buildLinqMessageParts(
  message: AdapterPostableMessage,
  client: LinqClient,
): Promise<LinqMessagePart[]> {
  const parts: LinqMessagePart[] = [];

  const card = extractCard(message);
  const files = extractFiles(message);
  const text = card
    ? cardToFallbackText(card, { boldFormat: "**" })
    : converter.renderPostable(message);

  if (text && text.trim().length > 0) {
    parts.push({ type: "text", value: text });
  }

  if (files.length > 0) {
    const uploaded = await Promise.all(files.map((f) => uploadFile(client, f)));
    parts.push(...(uploaded as LinqMediaPart[]));
  }

  if (parts.length === 0) {
    parts.push({ type: "text", value: "" });
  }

  return parts;
}

export function postableHasInlineAttachments(message: AdapterPostableMessage): boolean {
  if (typeof message === "string") return false;
  if (Array.isArray(message)) return false;
  if (typeof message !== "object" || message === null) return false;
  const m = message as { attachments?: unknown[] };
  return Array.isArray(m.attachments) && m.attachments.length > 0;
}
