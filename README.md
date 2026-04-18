# chat-adapter-linq

Vercel Chat SDK adapter for [Linq](https://linqapp.com). Send and receive iMessage / SMS / RCS through real devices via the [Linq Partner API](https://apidocs.linqapp.com).

## Install

```bash
bun add chat-adapter-linq chat
```

## Quick start

```ts
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createLinqAdapter } from "chat-adapter-linq";

const linq = createLinqAdapter({
  defaultFrom: "+12025551234",
  // apiKey: "...",            // or set LINQ_API_KEY env var
  // signingSecret: "...", // or set LINQ_WEBHOOK_SECRET env var
});

const chat = new Chat({
  userName: "linq-bot",
  adapters: { linq },
  state: createMemoryState(),
});

chat.onDirectMessage(async (thread, message) => {
  await thread.startTyping();
  await thread.post(`You said: ${message.text}`);
});

await chat.initialize();

// Wire chat.webhooks.linq to a public HTTPS endpoint that Linq POSTs to.
```

## Configuration

### Environment variables

| Variable              | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `LINQ_API_KEY`        | Linq Partner API bearer token (overridden by `config.apiKey`).               |
| `LINQ_WEBHOOK_SECRET` | HMAC-SHA256 webhook signing secret (overridden by `config.signingSecret`).   |
| `LINQ_FROM`           | E.164 phone number this bot sends from (overridden by `config.defaultFrom`). |

### `LinqAdapterConfig`

```ts
interface LinqAdapterConfig {
  /** Linq Partner API bearer token. */
  apiKey: string;
  /** HMAC-SHA256 webhook signing secret. Returned only when the subscription is created — store it. */
  signingSecret: string;
  /** E.164 phone number to send from (e.g. "+12025551234"). */
  defaultFrom: string;
  /** Override base URL. Default: "https://api.linqapp.com/api/partner". */
  baseUrl?: string;
  /** Bot username surfaced in handler context. Default: `linq:{defaultFrom}`. */
  userName?: string;
  /** Custom logger. */
  logger?: Logger;
  /** Override fetch (testing). */
  fetch?: typeof fetch;
  /** Reject webhooks older than this many seconds. Default: 300. */
  webhookToleranceSec?: number;
}
```

## Webhook setup

`POST /v3/webhook-subscriptions` with `?version=2026-02-03` on your target URL. The adapter only parses the `2026-02-03` payload format. The signing secret is returned exactly once — copy it into `LINQ_WEBHOOK_SECRET` immediately.

## Features

- Inbound messages (1:1 routes to `onDirectMessage`; group to `onSubscribedMessage` after subscribe).
- Outbound text, markdown, and Card postables (cards render as fallback text — iMessage has no rich card surface).
- Attachments via URL (≤10MB) or pre-upload (`POST /v3/attachments`, ≤100MB).
- Reactions: native tapbacks (`love`, `like`, `dislike`, `laugh`, `emphasize`, `question`) plus arbitrary emoji via `custom_emoji`.
- Edit (`PATCH /v3/messages/{id}`) and delete (`DELETE /v3/messages/{id}` — Linq-side only, not unsend).
- Typing indicator (DMs only; group chats silently no-op).
- `openDM(handle)` reuses an existing 1:1 chat or lazy-creates one on first `post()`.

## Unsupported

- Buttons, modals, slash commands, scheduled messages — iMessage doesn't have them.
- v2025-01-01 webhook payload format.
- `@bot` mentions — iMessage has no syntax for them. Use `onDirectMessage` for 1:1 and `onNewMessage(/.*/)` to opt into group threads.

## License

MIT
