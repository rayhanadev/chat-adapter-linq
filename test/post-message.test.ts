import { describe, expect, it, vi } from "vitest";
import type { CardElement } from "chat";
import { LinqClient } from "../src/client.js";
import { buildLinqMessageParts } from "../src/post-message.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch = vi.fn()) {
  return new LinqClient({ apiKey: "k", signingSecret: "s", defaultFrom: "+1", fetch: fetchImpl });
}

describe("buildLinqMessageParts", () => {
  it("converts plain text into a single text part", async () => {
    expect(await buildLinqMessageParts("hello", makeClient())).toEqual([
      { type: "text", value: "hello" },
    ]);
  });

  it("renders markdown postables to text", async () => {
    const parts = await buildLinqMessageParts({ markdown: "**bold**" }, makeClient());
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe("text");
  });

  it("falls back to card-as-text for card postables", async () => {
    const card: CardElement = {
      type: "card",
      title: "Order #42",
      children: [{ type: "text", content: "please review" }],
    };
    const parts = await buildLinqMessageParts(card, makeClient());
    expect(parts[0]?.type).toBe("text");
    expect((parts[0] as { value: string }).value.toLowerCase()).toContain("order");
  });

  it("uploads attached files and appends media parts", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v3/attachments")) {
        return jsonResponse({
          attachment_id: "att-1",
          upload_url: "https://uploads.example.com/file",
          download_url: "https://cdn.linqapp.com/x.png",
          http_method: "PUT",
          expires_at: "2099-01-01T00:00:00Z",
          required_headers: { "Content-Type": "image/png", "Content-Length": "3" },
        });
      }
      return new Response(null, { status: 200 });
    });
    const parts = await buildLinqMessageParts(
      {
        markdown: "see attached",
        files: [{ data: Buffer.from("png"), filename: "shot.png", mimeType: "image/png" }],
      },
      makeClient(fetchImpl),
    );
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({
      type: "media",
      attachment_id: "att-1",
      filename: "shot.png",
      mime_type: "image/png",
      size_bytes: 3,
    });
  });

  it("emits an empty text part when message has no content", async () => {
    expect(await buildLinqMessageParts({ raw: "" }, makeClient())).toEqual([
      { type: "text", value: "" },
    ]);
  });
});
