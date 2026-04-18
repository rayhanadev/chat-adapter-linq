import { describe, expect, it } from "vitest";
import received from "./fixtures/message-received.json" with { type: "json" };
import sent from "./fixtures/message-sent.json" with { type: "json" };
import { parseMessageEvent, partsToAttachments, partsToText } from "../src/parse-message.js";
import type { LinqMessageEventDataV2 } from "../src/types.js";

const BOT_FROM = "+12025551234";

describe("parseMessageEvent", () => {
  it("parses an inbound text message", () => {
    const msg = parseMessageEvent((received as { data: LinqMessageEventDataV2 }).data, {
      botFrom: BOT_FROM,
    });
    expect(msg.text).toBe("Hello!");
    expect(msg.author.userId).toBe("+12025559876");
    expect(msg.author.isMe).toBe(false);
    expect(msg.attachments).toEqual([]);
  });

  it("parses an outbound message with media", () => {
    const msg = parseMessageEvent((sent as { data: LinqMessageEventDataV2 }).data, {
      botFrom: BOT_FROM,
    });
    expect(msg.text).toBe("Hello from Linq!");
    expect(msg.author.isMe).toBe(true);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0]?.type).toBe("image");
    expect(typeof msg.attachments[0]?.fetchData).toBe("function");
  });

  it("partsToText concatenates and partsToAttachments classifies by mime", () => {
    expect(
      partsToText([
        { type: "text", value: "a" },
        { type: "text", value: "b" },
        { type: "media", url: "https://x" },
      ]),
    ).toBe("a\nb");

    expect(
      partsToAttachments([
        { type: "media", mime_type: "video/mp4", url: "https://x" },
        { type: "media", mime_type: "audio/m4a", url: "https://x" },
        { type: "media", mime_type: "application/pdf", url: "https://x" },
      ]).map((a) => a.type),
    ).toEqual(["video", "audio", "file"]);
  });
});
