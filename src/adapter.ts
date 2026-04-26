import { ValidationError } from "@chat-adapter/shared";
import { ConsoleLogger, Message, getEmoji, paragraph, root, text } from "chat";
import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  MessageData,
  RawMessage,
  ReactionEvent,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { LinqClient } from "./client.js";
import { LinqFormatConverter } from "./format-converter.js";
import { channelIdFromThreadId, decodeThreadId, encodeThreadId, type LinqThreadId } from "./ids.js";
import {
  handleToAuthor,
  parseEditedMessageEvent,
  parseMessageEvent,
  partsToText,
} from "./parse-message.js";
import { buildLinqMessageParts } from "./post-message.js";
import { emojiToReaction, reactionToEmoji } from "./reactions.js";
import {
  ADAPTER_NAME,
  type LinqAdapterConfig,
  type LinqMessageEditedEventDataV2,
  type LinqMessageEventDataV2,
  type LinqParticipantEventData,
  type LinqReactionEventData,
  type LinqTypingEventData,
} from "./types.js";
import { parseWebhookPayload, verifySignature, type LinqWebhookEvent } from "./webhook.js";

const TYPING_GROUP_DENIED_HINT = "group";

/**
 * Adapter that bridges the Vercel Chat SDK to the
 * [Linq Partner API](https://apidocs.linqapp.com).
 *
 * Construct via {@link createLinqAdapter} (recommended — supports env-var
 * fallbacks) or `new LinqAdapter(config)` directly.
 *
 * @public
 */
export class LinqAdapter implements Adapter<LinqThreadId, unknown> {
  readonly name = ADAPTER_NAME;
  readonly userName: string;

  private chat: ChatInstance | null = null;
  private logger: Logger;
  private readonly config: LinqAdapterConfig;
  private readonly client: LinqClient;
  private readonly converter = new LinqFormatConverter();

  constructor(config: LinqAdapterConfig) {
    this.config = config;
    this.userName = config.userName ?? `linq:${config.defaultFrom}`;
    this.logger = config.logger ?? new ConsoleLogger("info", ADAPTER_NAME);
    this.client = new LinqClient(config);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(ADAPTER_NAME);

    try {
      const { phone_numbers } = await this.client.listPhoneNumbers();
      const owns = phone_numbers.some((p) => p.phone_number === this.config.defaultFrom);
      if (!owns) {
        this.logger.warn(
          `defaultFrom ${this.config.defaultFrom} is not in this account's phone numbers (${phone_numbers
            .map((p) => p.phone_number)
            .join(", ")}). Sends will fail.`,
        );
      }
    } catch (err) {
      this.logger.warn("Failed to validate Linq credentials during initialize", err);
    }
  }

  async disconnect(): Promise<void> {
    // No persistent connection.
  }

  encodeThreadId(data: LinqThreadId): string {
    return encodeThreadId(data);
  }

  decodeThreadId(threadId: string): LinqThreadId {
    return decodeThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return channelIdFromThreadId(threadId);
  }

  isDM(threadId: string): boolean {
    const decoded = decodeThreadId(threadId);
    if (decoded.kind === "pending") return true;
    return !decoded.isGroup;
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const rawBody = await request.text();
    const timestamp = request.headers.get("x-webhook-timestamp");
    const signature = request.headers.get("x-webhook-signature");

    const verification = verifySignature({
      rawBody,
      timestamp,
      signature,
      signingSecret: this.config.signingSecret,
      toleranceSec: this.config.webhookToleranceSec,
    });
    if (!verification.ok) {
      this.logger.warn(`Rejected webhook: ${verification.reason}`);
      return new Response(verification.reason, { status: 401 });
    }

    let event: LinqWebhookEvent;
    try {
      event = parseWebhookPayload(rawBody);
    } catch (err) {
      this.logger.warn("Failed to parse webhook payload", err);
      return new Response("invalid payload", { status: 400 });
    }

    try {
      this.dispatchEvent(event, options);
    } catch (err) {
      this.logger.error("Webhook dispatch failed", err);
    }
    return new Response("ok", { status: 200 });
  }

  parseMessage(raw: unknown): Message<unknown> {
    const data = raw as LinqMessageEventDataV2;
    return parseMessageEvent(data, { botFrom: this.config.defaultFrom });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const decoded = decodeThreadId(threadId);
    const parts = await buildLinqMessageParts(message, this.client);

    if (decoded.kind === "pending") {
      const created = await this.client.createChat({
        from: decoded.from,
        to: [decoded.recipient],
        message: { parts },
      });
      const newThreadId = encodeThreadId({
        kind: "chat",
        from: decoded.from,
        chatId: created.chat.id,
        isGroup: created.chat.is_group,
      });
      return {
        id: created.chat.message.id,
        raw: created,
        threadId: newThreadId,
      };
    }

    const sent = await this.client.sendMessage(decoded.chatId, { message: { parts } });
    return {
      id: sent.message.id,
      raw: sent,
      threadId,
    };
  }

  /**
   * Post a message as a threaded reply to a prior message in the same chat.
   *
   * Produces a native iMessage swipe-reply bubble pointing at
   * `parentMessageId`. Requires a real (non-pending) thread — the parent must
   * already exist.
   *
   * @param threadId - The thread to post in
   * @param parentMessageId - UUID of the message being replied to
   * @param message - The reply body (same shape accepted by {@link postMessage})
   * @param options - Optional `partIndex` when the parent has multiple parts
   *   (defaults to `0`, matching Linq's default)
   */
  async postReply(
    threadId: string,
    parentMessageId: string,
    message: AdapterPostableMessage,
    options?: { partIndex?: number },
  ): Promise<RawMessage<unknown>> {
    const decoded = decodeThreadId(threadId);
    if (decoded.kind === "pending") {
      throw new ValidationError(
        ADAPTER_NAME,
        "postReply requires an existing chat — cannot reply in a pending thread.",
      );
    }
    const parts = await buildLinqMessageParts(message, this.client);
    const reply_to: { message_id: string; part_index?: number } = {
      message_id: parentMessageId,
    };
    if (options?.partIndex !== undefined) reply_to.part_index = options.partIndex;
    const sent = await this.client.sendMessage(decoded.chatId, {
      message: { parts, reply_to },
    });
    return {
      id: sent.message.id,
      raw: sent,
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const newText = this.converter.renderPostable(message);
    const result = await this.client.editMessage(messageId, { part_index: 0, text: newText });
    return { id: messageId, raw: result, threadId };
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await this.client.deleteMessage(messageId);
  }

  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const mapped = emojiToReaction(emoji);
    await this.client.sendReaction(messageId, { operation: "add", ...mapped });
  }

  async removeReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const mapped = emojiToReaction(emoji);
    await this.client.sendReaction(messageId, { operation: "remove", ...mapped });
  }

  async fetchMessages(threadId: string, options?: FetchOptions): Promise<FetchResult<unknown>> {
    const decoded = decodeThreadId(threadId);
    if (decoded.kind === "pending") {
      return { messages: [] };
    }

    const { messages, next_cursor } = await this.client.getMessages(decoded.chatId, {
      cursor: options?.cursor,
      limit: options?.limit,
    });

    const parsed = messages.map((m) => {
      const data: MessageData<unknown> = {
        id: m.id,
        threadId,
        text: partsToText(m.parts),
        formatted: emptyFormatted(),
        raw: m,
        author: stubAuthor(),
        metadata: {
          dateSent: new Date(m.sent_at),
          edited: false,
        },
        attachments: [],
      };
      return new Message<unknown>(data);
    });

    return {
      messages: parsed,
      nextCursor: next_cursor ?? undefined,
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = decodeThreadId(threadId);
    if (decoded.kind === "pending") {
      return {
        id: threadId,
        channelId: this.channelIdFromThreadId(threadId),
        isDM: true,
        metadata: { from: decoded.from, recipient: decoded.recipient, pending: true },
      };
    }

    const chat = await this.client.getChat(decoded.chatId);
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      channelName: chat.display_name,
      isDM: !chat.is_group,
      metadata: {
        from: decoded.from,
        chatId: chat.id,
        service: chat.service,
        isGroup: chat.is_group,
        handles: chat.handles,
        createdAt: chat.created_at,
      },
    };
  }

  async startTyping(threadId: string): Promise<void> {
    const decoded = decodeThreadId(threadId);
    if (decoded.kind === "pending") return;
    try {
      await this.client.startTyping(decoded.chatId);
    } catch (err) {
      if (isGroupForbidden(err)) {
        this.logger.debug("startTyping ignored for group chat", { threadId });
        return;
      }
      throw err;
    }
  }

  /**
   * Mark all messages in a chat as read.
   *
   * Produces the native iMessage "Read" indicator on the sender's side for the
   * most recent message. No-op for pending threads (nothing to mark yet).
   *
   * @param threadId - The thread whose messages should be marked read
   */
  async markRead(threadId: string): Promise<void> {
    const decoded = decodeThreadId(threadId);
    if (decoded.kind === "pending") return;
    await this.client.markChatAsRead(decoded.chatId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }

  async openDM(userId: string): Promise<string> {
    const from = this.config.defaultFrom;
    const { chats } = await this.client.listChats({ from, to: userId, limit: 1 });
    const existing = chats[0];
    if (existing && !existing.is_group) {
      return encodeThreadId({ kind: "chat", from, chatId: existing.id, isGroup: false });
    }
    return encodeThreadId({ kind: "pending", from, recipient: userId });
  }

  private dispatchEvent(event: LinqWebhookEvent, options?: WebhookOptions): void {
    if (!this.chat) {
      this.logger.warn(`Received webhook ${event.event_type} before initialize`);
      return;
    }

    switch (event.event_type) {
      case "message.received":
      case "message.sent": {
        const data = event.data as LinqMessageEventDataV2;
        const threadId = encodeThreadId({
          kind: "chat",
          from: this.config.defaultFrom,
          chatId: data.chat.id,
          isGroup: data.chat.is_group,
        });
        const message = parseMessageEvent(data, { botFrom: this.config.defaultFrom });
        this.chat.processMessage(this, threadId, message, options);
        return;
      }
      case "message.edited": {
        const data = event.data as LinqMessageEditedEventDataV2;
        const threadId = encodeThreadId({
          kind: "chat",
          from: this.config.defaultFrom,
          chatId: data.chat.id,
          isGroup: data.chat.is_group,
        });
        const message = parseEditedMessageEvent(data, { botFrom: this.config.defaultFrom });
        this.chat.processMessage(this, threadId, message, options);
        return;
      }
      case "message.delivered":
      case "message.read":
      case "message.failed": {
        this.logger.debug(`Linq event: ${event.event_type}`, { event_id: event.event_id });
        return;
      }
      case "reaction.added":
      case "reaction.removed": {
        const data = event.data as LinqReactionEventData;
        // Reaction payloads don't carry is_group; default to DM (false).
        // For groups, the message routing still works because reactions don't
        // need DM/mention disambiguation.
        const threadId = encodeThreadId({
          kind: "chat",
          from: this.config.defaultFrom,
          chatId: data.chat_id,
          isGroup: false,
        });
        const rawEmoji = reactionToEmoji(data.reaction_type, data.custom_emoji);
        const reactionEvent: Omit<ReactionEvent, "adapter" | "thread"> & { adapter?: Adapter } = {
          adapter: this,
          added: event.event_type === "reaction.added",
          emoji: getEmoji(emojiNameForReaction(data.reaction_type)),
          messageId: data.message_id,
          raw: data,
          rawEmoji,
          threadId,
          user: handleToAuthor(data.from_handle, data.is_from_me),
        };
        this.chat.processReaction(reactionEvent, options);
        return;
      }
      case "chat.typing_indicator.started":
      case "chat.typing_indicator.stopped": {
        const data = event.data as LinqTypingEventData;
        this.logger.debug(`typing ${event.event_type}`, { chat_id: data.chat_id });
        return;
      }
      case "participant.added":
      case "participant.removed":
      case "chat.created":
      case "chat.group_name_updated":
      case "chat.group_icon_updated":
      case "chat.group_name_update_failed":
      case "chat.group_icon_update_failed":
      case "phone_number.status_updated": {
        this.logger.debug(`Linq event: ${event.event_type}`, {
          data: event.data as LinqParticipantEventData | unknown,
        });
        return;
      }
      default: {
        this.logger.debug(`Unhandled Linq event: ${event.event_type}`);
      }
    }
  }
}

function stubAuthor(): Author {
  return {
    userId: "unknown",
    userName: "unknown",
    fullName: "unknown",
    isBot: "unknown",
    isMe: false,
  };
}

function emptyFormatted(): FormattedContent {
  return root([paragraph([text("")])]);
}

function isGroupForbidden(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.toLowerCase().includes(TYPING_GROUP_DENIED_HINT);
}

function emojiNameForReaction(type: string): string {
  switch (type) {
    case "love":
      return "heart";
    case "like":
      return "thumbs_up";
    case "dislike":
      return "thumbs_down";
    case "laugh":
      return "laugh";
    case "emphasize":
      return "exclamation";
    case "question":
      return "question";
    default:
      return "heart";
  }
}

/**
 * Create a {@link LinqAdapter} from explicit config or environment variables.
 *
 * Reads `LINQ_API_KEY`, `LINQ_WEBHOOK_SECRET`, and `LINQ_FROM` as fallbacks
 * for any field not passed in `config`. Throws `ValidationError` if any of
 * the three required values is still missing after the env lookup.
 *
 * @example
 * ```ts
 * const adapter = createLinqAdapter({
 *   apiKey: process.env.LINQ_API_KEY!,
 *   signingSecret: process.env.LINQ_WEBHOOK_SECRET!,
 *   defaultFrom: "+12025551234",
 * });
 * ```
 *
 * @public
 */
export function createLinqAdapter(
  config?: Partial<LinqAdapterConfig> & { logger?: Logger },
): LinqAdapter {
  const apiKey = config?.apiKey ?? process.env.LINQ_API_KEY;
  const signingSecret = config?.signingSecret ?? process.env.LINQ_WEBHOOK_SECRET;
  const defaultFrom = config?.defaultFrom ?? process.env.LINQ_FROM;

  if (!apiKey) {
    throw new ValidationError(
      ADAPTER_NAME,
      "Linq API key is required. Pass it in config or set LINQ_API_KEY.",
    );
  }
  if (!signingSecret) {
    throw new ValidationError(
      ADAPTER_NAME,
      "Linq webhook signing secret is required. Pass it in config or set LINQ_WEBHOOK_SECRET.",
    );
  }
  if (!defaultFrom) {
    throw new ValidationError(
      ADAPTER_NAME,
      "Linq sender phone number is required. Pass `defaultFrom` in config or set LINQ_FROM (E.164 format).",
    );
  }

  return new LinqAdapter({
    apiKey,
    signingSecret,
    defaultFrom,
    baseUrl: config?.baseUrl,
    userName: config?.userName,
    logger: config?.logger,
    fetch: config?.fetch,
    webhookToleranceSec: config?.webhookToleranceSec,
  }) satisfies Adapter<LinqThreadId, unknown>;
}
