import type { Logger } from "chat";

export const ADAPTER_NAME = "linq";
export const DEFAULT_BASE_URL = "https://api.linqapp.com/api/partner";
export const WEBHOOK_VERSION = "2026-02-03" as const;

/**
 * Configuration for the Linq adapter.
 *
 * Use {@link createLinqAdapter} to construct an adapter instance from this
 * config (with environment-variable fallbacks), or `new LinqAdapter(config)`
 * directly when all fields are known at construction time.
 *
 * @public
 */
export interface LinqAdapterConfig {
  /** Linq Partner API bearer token. */
  apiKey: string;
  /**
   * HMAC-SHA256 secret returned when the webhook subscription was created.
   * Used to verify `X-Webhook-Signature` headers. Can never be retrieved
   * again from Linq, so must be persisted on subscription creation.
   */
  signingSecret: string;
  /**
   * E.164 phone number on the partner account that this adapter sends from.
   * Becomes the `from` field on outbound messages and is encoded into every
   * thread ID so a single account with multiple lines stays unambiguous.
   */
  defaultFrom: string;
  /** API base URL. Defaults to `https://api.linqapp.com/api/partner`. */
  baseUrl?: string;
  /** Bot username surfaced in handler context. Defaults to `linq:{defaultFrom}`. */
  userName?: string;
  /** Optional Chat SDK logger. Defaults to `ConsoleLogger("info")`. */
  logger?: Logger;
  /** Override the global `fetch` (mostly for testing). */
  fetch?: typeof fetch;
  /**
   * Reject webhooks whose `X-Webhook-Timestamp` is more than this many seconds
   * away from the current time. Defaults to `300` (5 minutes), per Linq's
   * recommended replay-protection window.
   */
  webhookToleranceSec?: number;
}

export type LinqService = "iMessage" | "SMS" | "RCS";

export interface LinqHandle {
  id: string;
  handle: string;
  is_me: boolean;
  service: LinqService;
  status: "active" | "removed" | "pending" | "left";
  joined_at: string;
  left_at: string | null;
}

export type LinqMessagePart = LinqTextPart | LinqMediaPart | LinqLinkPart | LinqVoiceMemoPart;

export interface LinqTextPart {
  type: "text";
  value: string;
  text_decorations?: LinqTextDecoration[];
}

export interface LinqTextDecoration {
  range: [number, number];
  style?: "bold" | "italic" | "strikethrough" | "underline";
  animation?: "big" | "small" | "shake" | "nod" | "explode" | "ripple" | "bloom" | "jitter";
}

export interface LinqMediaPart {
  type: "media";
  url?: string;
  attachment_id?: string;
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
  id?: string;
}

export interface LinqLinkPart {
  type: "link";
  url: string;
}

export interface LinqVoiceMemoPart {
  type: "voice_memo";
  url?: string;
  attachment_id?: string;
}

export type LinqMessageEffect = { type: "screen"; name: string } | { type: "bubble"; name: string };

export interface LinqMessage {
  id: string;
  parts: LinqMessagePart[];
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  service: LinqService;
  effect?: LinqMessageEffect | null;
}

export interface LinqChatRef {
  id: string;
  is_group: boolean;
  owner_handle: LinqHandle;
}

export interface LinqChat {
  id: string;
  display_name: string;
  service: LinqService;
  handles: LinqHandle[];
  is_group: boolean;
  created_at: string;
  updated_at: string;
}

export interface LinqWebhookEnvelope<TData> {
  api_version: "v3";
  webhook_version: typeof WEBHOOK_VERSION;
  event_type: string;
  event_id: string;
  created_at: string;
  trace_id: string;
  partner_id: string;
  data: TData;
}

export interface LinqMessageEventDataV2 {
  chat: LinqChatRef;
  id: string;
  idempotency_key?: string | null;
  direction: "inbound" | "outbound";
  sender_handle: LinqHandle;
  parts: LinqMessagePart[];
  effect: LinqMessageEffect | null;
  reply_to?: { message_id: string } | null;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  service: LinqService;
  preferred_service?: LinqService | null;
}

export interface LinqMessageEditedEventDataV2 {
  chat: LinqChatRef;
  id: string;
  direction: "inbound" | "outbound";
  sender_handle: LinqHandle;
  part: { index: number; text: string };
  edited_at: string;
}

export interface LinqReactionEventData {
  chat_id: string;
  message_id: string;
  part_index: number;
  reaction_type: LinqReactionType;
  custom_emoji: string | null;
  is_from_me: boolean;
  from: string;
  from_handle: LinqHandle;
  service: LinqService;
  reacted_at: string;
  sticker: unknown;
}

export interface LinqTypingEventData {
  chat_id: string;
}

export interface LinqParticipantEventData {
  chat_id: string;
  handle: string;
  participant: LinqHandle;
  added_at?: string;
  removed_at?: string;
}

export type LinqReactionType =
  | "love"
  | "like"
  | "dislike"
  | "laugh"
  | "emphasize"
  | "question"
  | "custom";

export interface LinqPhoneNumber {
  id: string;
  phone_number: string;
}

export interface LinqListPhoneNumbersResponse {
  phone_numbers: LinqPhoneNumber[];
}

export interface LinqListChatsResponse {
  chats: LinqChat[];
  next_cursor: string | null;
}

export interface LinqGetMessagesResponse {
  messages: LinqMessage[];
  next_cursor: string | null;
}

export interface LinqCreateChatRequest {
  from: string;
  to: string[];
  message: { parts: LinqMessagePart[]; effect?: LinqMessageEffect };
}

export interface LinqSentMessage {
  id: string;
  parts: LinqMessagePart[];
  sent_at?: string;
  delivered_at?: string | null;
  read_at?: string | null;
  service?: LinqService;
  effect?: LinqMessageEffect | null;
}

export interface LinqCreateChatResponse {
  chat: {
    id: string;
    display_name: string | null;
    service: LinqService;
    is_group: boolean;
    handles: LinqHandle[];
    message: LinqSentMessage;
  };
}

export interface LinqSendMessageResponse {
  chat_id: string;
  message: LinqSentMessage;
}

export interface LinqUploadRequest {
  filename: string;
  content_type: string;
  size_bytes: number;
}

export interface LinqUploadResponse {
  attachment_id: string;
  upload_url: string;
  download_url: string;
  http_method: "PUT";
  expires_at: string;
  required_headers: Record<string, string>;
}

export interface LinqErrorBody {
  success: false;
  error: {
    status: number;
    code: number;
    message: string;
    retry_after?: number;
  };
  trace_id?: string;
}
