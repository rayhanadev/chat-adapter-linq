import type { Logger } from "chat";
import { mapHttpError, wrapNetworkError } from "./errors.js";
import {
  DEFAULT_BASE_URL,
  type LinqAdapterConfig,
  type LinqChat,
  type LinqCreateChatRequest,
  type LinqCreateChatResponse,
  type LinqGetMessagesResponse,
  type LinqListChatsResponse,
  type LinqListPhoneNumbersResponse,
  type LinqMessagePart,
  type LinqMessageEffect,
  type LinqReactionType,
  type LinqSendMessageResponse,
  type LinqUploadRequest,
  type LinqUploadResponse,
} from "./types.js";

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  acceptStatuses?: number[];
}

export class LinqClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Logger;

  constructor(config: LinqAdapterConfig & { logger?: Logger }) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? fetch;
    this.logger = config.logger;
  }

  async listPhoneNumbers(): Promise<LinqListPhoneNumbersResponse> {
    return this.request<LinqListPhoneNumbersResponse>("GET", "/v3/phone_numbers");
  }

  async getChat(chatId: string): Promise<LinqChat> {
    return this.request<LinqChat>("GET", `/v3/chats/${encodeURIComponent(chatId)}`);
  }

  async listChats(params: {
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  }): Promise<LinqListChatsResponse> {
    return this.request<LinqListChatsResponse>("GET", "/v3/chats", { query: params });
  }

  async getMessages(
    chatId: string,
    params: { cursor?: string; limit?: number },
  ): Promise<LinqGetMessagesResponse> {
    return this.request<LinqGetMessagesResponse>(
      "GET",
      `/v3/chats/${encodeURIComponent(chatId)}/messages`,
      { query: params },
    );
  }

  async createChat(body: LinqCreateChatRequest): Promise<LinqCreateChatResponse> {
    return this.request<LinqCreateChatResponse>("POST", "/v3/chats", {
      body,
      acceptStatuses: [200, 201, 202],
    });
  }

  async sendMessage(
    chatId: string,
    body: { message: { parts: LinqMessagePart[]; effect?: LinqMessageEffect } },
  ): Promise<LinqSendMessageResponse> {
    return this.request<LinqSendMessageResponse>(
      "POST",
      `/v3/chats/${encodeURIComponent(chatId)}/messages`,
      { body, acceptStatuses: [200, 201, 202] },
    );
  }

  async editMessage(
    messageId: string,
    body: { part_index: number; text: string },
  ): Promise<unknown> {
    return this.request<unknown>("PATCH", `/v3/messages/${encodeURIComponent(messageId)}`, {
      body,
      acceptStatuses: [200, 204],
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.request<void>("DELETE", `/v3/messages/${encodeURIComponent(messageId)}`, {
      acceptStatuses: [200, 204],
    });
  }

  async sendReaction(
    messageId: string,
    body: {
      operation: "add" | "remove";
      type: LinqReactionType;
      custom_emoji?: string;
      part_index?: number;
    },
  ): Promise<void> {
    await this.request<void>("POST", `/v3/messages/${encodeURIComponent(messageId)}/reactions`, {
      body,
      acceptStatuses: [200, 202, 204],
    });
  }

  async startTyping(chatId: string): Promise<void> {
    await this.request<void>("POST", `/v3/chats/${encodeURIComponent(chatId)}/typing`, {
      acceptStatuses: [200, 204],
    });
  }

  async stopTyping(chatId: string): Promise<void> {
    await this.request<void>("DELETE", `/v3/chats/${encodeURIComponent(chatId)}/typing`, {
      acceptStatuses: [200, 204],
    });
  }

  async requestUpload(body: LinqUploadRequest): Promise<LinqUploadResponse> {
    return this.request<LinqUploadResponse>("POST", "/v3/attachments", { body });
  }

  async putUpload(uploadUrl: string, headers: Record<string, string>, body: Buffer): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(uploadUrl, {
        method: "PUT",
        headers,
        body: body as unknown as BodyInit,
      });
    } catch (err) {
      throw wrapNetworkError(err);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw mapHttpError({
        status: response.status,
        body: { error: { message: text || response.statusText, status: response.status, code: 0 } },
      });
    }
  }

  private async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    this.logger?.debug?.(`[linq] ${method} ${url}`);

    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers, body });
    } catch (err) {
      throw wrapNetworkError(err);
    }

    const acceptStatuses = opts.acceptStatuses ?? [200];
    if (!acceptStatuses.includes(response.status) && !response.ok) {
      const errorBody = await safeJson(response);
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
      throw mapHttpError({ status: response.status, body: errorBody, retryAfter });
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
