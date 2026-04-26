import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import received from "./fixtures/message-received.json" with { type: "json" };
import sent from "./fixtures/message-sent.json" with { type: "json" };
import reactionAdded from "./fixtures/reaction-added.json" with { type: "json" };
import { LinqAdapter, createLinqAdapter } from "../src/adapter.js";
import { encodeThreadId } from "../src/ids.js";

const FROM = "+12025551234";
const SECRET = "linq-test-secret";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function makeFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const body = init?.body ? safeParse(init.body as string) : undefined;
    return handler({ url, method: init?.method ?? "GET", headers, body });
  });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildAdapter(fetchImpl: typeof fetch): LinqAdapter {
  return createLinqAdapter({
    apiKey: "test-key",
    signingSecret: SECRET,
    defaultFrom: FROM,
    fetch: fetchImpl,
  });
}

function signedRequest(body: string): Request {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  return new Request("https://example.com/webhook/linq", {
    method: "POST",
    headers: {
      "x-webhook-timestamp": ts,
      "x-webhook-signature": sig,
      "content-type": "application/json",
    },
    body,
  });
}

function mockChatInstance(overrides: Record<string, unknown> = {}): never {
  return {
    getLogger: () => console,
    getState: () => ({}),
    getUserName: () => "linq-bot",
    handleIncomingMessage: vi.fn(),
    processMessage: vi.fn(),
    processAction: vi.fn(),
    processReaction: vi.fn(),
    processSlashCommand: vi.fn(),
    processModalSubmit: vi.fn(),
    processModalClose: vi.fn(),
    processAppHomeOpened: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processMemberJoinedChannel: vi.fn(),
    ...overrides,
  } as never;
}

describe("createLinqAdapter", () => {
  beforeEach(() => {
    delete process.env.LINQ_API_KEY;
    delete process.env.LINQ_WEBHOOK_SECRET;
    delete process.env.LINQ_FROM;
  });

  it("requires apiKey, signingSecret, and defaultFrom", () => {
    expect(() => createLinqAdapter({ signingSecret: "s", defaultFrom: "+1" })).toThrow(/API key/);
    expect(() => createLinqAdapter({ apiKey: "k", defaultFrom: "+1" })).toThrow(/signing secret/);
    expect(() => createLinqAdapter({ apiKey: "k", signingSecret: "s" })).toThrow(
      /sender phone number/,
    );
  });

  it("reads from environment variables", () => {
    process.env.LINQ_API_KEY = "env-key";
    process.env.LINQ_WEBHOOK_SECRET = "env-secret";
    process.env.LINQ_FROM = "+13335551212";
    expect(createLinqAdapter()).toBeInstanceOf(LinqAdapter);
  });
});

describe("LinqAdapter properties", () => {
  it("exposes name and userName", () => {
    const adapter = buildAdapter(vi.fn());
    expect(adapter.name).toBe("linq");
    expect(adapter.userName).toBe(`linq:${FROM}`);
  });

  it("isDM returns true for DMs and pending, false for groups", () => {
    const adapter = buildAdapter(vi.fn());
    expect(
      adapter.isDM(encodeThreadId({ kind: "chat", from: FROM, chatId: "x", isGroup: false })),
    ).toBe(true);
    expect(
      adapter.isDM(encodeThreadId({ kind: "chat", from: FROM, chatId: "x", isGroup: true })),
    ).toBe(false);
    expect(adapter.isDM(encodeThreadId({ kind: "pending", from: FROM, recipient: "+1" }))).toBe(
      true,
    );
  });
});

describe("LinqAdapter postMessage", () => {
  it("sends a text message to an existing chat", async () => {
    const fetchImpl = makeFetch(({ url, method, body }) => {
      expect(url).toContain("/v3/chats/chat-1/messages");
      expect(method).toBe("POST");
      expect(body).toEqual({ message: { parts: [{ type: "text", value: "Hello!" }] } });
      return jsonResponse({ chat_id: "chat-1", message: { id: "msg-1", parts: [] } }, 202);
    });
    const adapter = buildAdapter(fetchImpl);
    const result = await adapter.postMessage(
      encodeThreadId({ kind: "chat", from: FROM, chatId: "chat-1", isGroup: false }),
      "Hello!",
    );
    expect(result.id).toBe("msg-1");
  });

  it("creates a chat first when posting to a pending thread", async () => {
    const fetchImpl = makeFetch(({ url, body }) => {
      expect(url).toContain("/v3/chats");
      expect(body).toMatchObject({ from: FROM, to: ["+15551234567"] });
      return jsonResponse(
        {
          chat: {
            id: "new-chat",
            display_name: "+15551234567",
            service: "iMessage",
            is_group: false,
            handles: [],
            message: { id: "first-msg", parts: [{ type: "text", value: "hi" }] },
          },
        },
        201,
      );
    });
    const adapter = buildAdapter(fetchImpl);
    const result = await adapter.postMessage(
      encodeThreadId({ kind: "pending", from: FROM, recipient: "+15551234567" }),
      "hi",
    );
    expect(result.id).toBe("first-msg");
    expect(result.threadId).toBe(
      encodeThreadId({ kind: "chat", from: FROM, chatId: "new-chat", isGroup: false }),
    );
  });
});

describe("LinqAdapter postReply", () => {
  it("nests reply_to under message when threading a reply", async () => {
    const fetchImpl = makeFetch(({ url, method, body }) => {
      expect(url).toContain("/v3/chats/chat-1/messages");
      expect(method).toBe("POST");
      expect(body).toEqual({
        message: {
          parts: [{ type: "text", value: "Thanks!" }],
          reply_to: { message_id: "parent-msg" },
        },
      });
      return jsonResponse({ chat_id: "chat-1", message: { id: "reply-1", parts: [] } }, 202);
    });
    const adapter = buildAdapter(fetchImpl);
    const result = await adapter.postReply(
      encodeThreadId({ kind: "chat", from: FROM, chatId: "chat-1", isGroup: false }),
      "parent-msg",
      "Thanks!",
    );
    expect(result.id).toBe("reply-1");
  });

  it("includes part_index when provided", async () => {
    const fetchImpl = makeFetch(({ body }) => {
      expect(body).toEqual({
        message: {
          parts: [{ type: "text", value: "yes" }],
          reply_to: { message_id: "parent-msg", part_index: 2 },
        },
      });
      return jsonResponse({ chat_id: "chat-1", message: { id: "reply-1", parts: [] } }, 202);
    });
    const adapter = buildAdapter(fetchImpl);
    await adapter.postReply(
      encodeThreadId({ kind: "chat", from: FROM, chatId: "chat-1", isGroup: false }),
      "parent-msg",
      "yes",
      { partIndex: 2 },
    );
  });

  it("rejects replying in a pending thread (no parent exists yet)", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({}, 500));
    const adapter = buildAdapter(fetchImpl);
    await expect(
      adapter.postReply(
        encodeThreadId({ kind: "pending", from: FROM, recipient: "+15551234567" }),
        "parent-msg",
        "hi",
      ),
    ).rejects.toThrow(/postReply/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("LinqAdapter editMessage / deleteMessage", () => {
  it("edits via PATCH /v3/messages/{id}", async () => {
    const fetchImpl = makeFetch(({ url, method, body }) => {
      expect(method).toBe("PATCH");
      expect(url).toContain("/v3/messages/msg-1");
      expect(body).toEqual({ part_index: 0, text: "Edited" });
      return jsonResponse({ id: "msg-1" });
    });
    const adapter = buildAdapter(fetchImpl);
    await adapter.editMessage(
      encodeThreadId({ kind: "chat", from: FROM, chatId: "chat-1", isGroup: false }),
      "msg-1",
      "Edited",
    );
  });

  it("deletes via DELETE /v3/messages/{id}", async () => {
    const fetchImpl = makeFetch(({ method, url }) => {
      expect(method).toBe("DELETE");
      expect(url).toContain("/v3/messages/msg-1");
      return new Response(null, { status: 204 });
    });
    const adapter = buildAdapter(fetchImpl);
    await adapter.deleteMessage("anything", "msg-1");
  });
});

describe("LinqAdapter reactions", () => {
  it("maps tapback emoji to native reaction types", async () => {
    const fetchImpl = makeFetch(({ body }) => {
      expect(body).toEqual({ operation: "add", type: "love" });
      return new Response(null, { status: 202 });
    });
    await buildAdapter(fetchImpl).addReaction("ignored", "msg-1", "\u2764\ufe0f");
  });

  it("falls back to custom_emoji for unknown emoji", async () => {
    const fetchImpl = makeFetch(({ body }) => {
      expect(body).toEqual({ operation: "remove", type: "custom", custom_emoji: "\ud83d\ude80" });
      return new Response(null, { status: 202 });
    });
    await buildAdapter(fetchImpl).removeReaction("ignored", "msg-1", "\ud83d\ude80");
  });
});

describe("LinqAdapter startTyping", () => {
  it("swallows 403 (group chat) without throwing", async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse(
        {
          success: false,
          error: { status: 403, code: 2005, message: "Typing in group chat not supported" },
        },
        403,
      ),
    );
    await expect(
      buildAdapter(fetchImpl).startTyping(
        encodeThreadId({ kind: "chat", from: FROM, chatId: "chat-1", isGroup: false }),
      ),
    ).resolves.toBeUndefined();
  });

  it("is a no-op for pending threads", async () => {
    const fetchImpl = vi.fn();
    await buildAdapter(fetchImpl as unknown as typeof fetch).startTyping(
      encodeThreadId({ kind: "pending", from: FROM, recipient: "+1" }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("LinqAdapter markRead", () => {
  it("POSTs to /v3/chats/{id}/read for an existing chat", async () => {
    const fetchImpl = makeFetch(({ url, method }) => {
      expect(method).toBe("POST");
      expect(url).toContain("/v3/chats/chat-1/read");
      return new Response(null, { status: 204 });
    });
    await buildAdapter(fetchImpl).markRead(
      encodeThreadId({ kind: "chat", from: FROM, chatId: "chat-1", isGroup: false }),
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("is a no-op for pending threads", async () => {
    const fetchImpl = vi.fn();
    await buildAdapter(fetchImpl as unknown as typeof fetch).markRead(
      encodeThreadId({ kind: "pending", from: FROM, recipient: "+1" }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("LinqAdapter openDM", () => {
  it("reuses an existing 1:1 chat", async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({
        chats: [
          {
            id: "existing",
            display_name: "+15551234567",
            service: "iMessage",
            handles: [],
            is_group: false,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        next_cursor: null,
      }),
    );
    expect(await buildAdapter(fetchImpl).openDM("+15551234567")).toBe(
      encodeThreadId({ kind: "chat", from: FROM, chatId: "existing", isGroup: false }),
    );
  });

  it("returns a pending thread when no chat exists", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ chats: [], next_cursor: null }));
    expect(await buildAdapter(fetchImpl).openDM("+15551234567")).toBe(
      encodeThreadId({ kind: "pending", from: FROM, recipient: "+15551234567" }),
    );
  });
});

describe("LinqAdapter fetchMessages", () => {
  it("does not crash on tombstone messages with null parts", async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({
        messages: [
          {
            id: "msg-real",
            parts: [{ type: "text", value: "hello" }],
            sent_at: "2026-01-01T00:00:00Z",
            delivered_at: null,
            read_at: null,
            service: "iMessage",
          },
          {
            // Linq returns `parts: null` for deleted/system messages even
            // though the declared type is non-nullable.
            id: "msg-tombstone",
            parts: null,
            sent_at: "2026-01-01T00:00:01Z",
            delivered_at: null,
            read_at: null,
            service: "iMessage",
          },
        ],
        next_cursor: null,
      }),
    );

    const adapter = buildAdapter(fetchImpl);
    const threadId = encodeThreadId({
      kind: "chat",
      from: FROM,
      chatId: "chat-1",
      isGroup: false,
    });
    const result = await adapter.fetchMessages(threadId);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.text).toBe("hello");
    expect(result.messages[1]?.text).toBe("");
  });
});

describe("LinqAdapter handleWebhook", () => {
  it("rejects unsigned requests with 401", async () => {
    const adapter = buildAdapter(vi.fn());
    const res = await adapter.handleWebhook(
      new Request("https://example.com/webhook/linq", {
        method: "POST",
        body: JSON.stringify(received),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("dispatches inbound DMs through chat.processMessage", async () => {
    const adapter = buildAdapter(vi.fn() as unknown as typeof fetch);
    const processMessage = vi.fn();
    await adapter.initialize(mockChatInstance({ processMessage }));

    const res = await adapter.handleWebhook(signedRequest(JSON.stringify(received)));
    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledOnce();
    const [, threadId, message] = processMessage.mock.calls[0]!;
    expect(message.text).toBe("Hello!");
    expect(threadId.startsWith("linq:c:")).toBe(true);
  });

  it("dispatches reactions through chat.processReaction with adapter set", async () => {
    const adapter = buildAdapter(vi.fn() as unknown as typeof fetch);
    const processReaction = vi.fn();
    await adapter.initialize(mockChatInstance({ processReaction }));

    const res = await adapter.handleWebhook(signedRequest(JSON.stringify(reactionAdded)));
    expect(res.status).toBe(200);
    expect(processReaction).toHaveBeenCalledOnce();
    const [event] = processReaction.mock.calls[0]!;
    expect(event.adapter).toBe(adapter);
    expect(event.added).toBe(true);
    expect(event.messageId).toBe("550e8400-e29b-41d4-a716-446655440001");
  });

  it("acknowledges outbound message.sent events", async () => {
    const adapter = buildAdapter(vi.fn() as unknown as typeof fetch);
    const res = await adapter.handleWebhook(signedRequest(JSON.stringify(sent)));
    expect(res.status).toBe(200);
  });
});
