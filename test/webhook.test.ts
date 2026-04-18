import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ValidationError } from "@chat-adapter/shared";
import { parseWebhookPayload, verifySignature } from "../src/webhook.js";

const SECRET = "test-secret";
const sign = (ts: string, body: string) =>
  createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");

describe("verifySignature", () => {
  const now = () => 1_700_000_000_000;
  const timestamp = "1700000000";
  const body = '{"event_type":"message.received","event_id":"1"}';

  it("accepts a valid signature", () => {
    expect(
      verifySignature({
        rawBody: body,
        timestamp,
        signature: sign(timestamp, body),
        signingSecret: SECRET,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects missing headers, stale timestamps, and tampered payloads", () => {
    expect(
      verifySignature({
        rawBody: body,
        timestamp: null,
        signature: "x",
        signingSecret: SECRET,
        now,
      }).ok,
    ).toBe(false);
    expect(
      verifySignature({
        rawBody: body,
        timestamp: String(Math.floor(now() / 1000) - 3600),
        signature: "x",
        signingSecret: SECRET,
        now,
      }).ok,
    ).toBe(false);
    expect(
      verifySignature({
        rawBody: body + "tampered",
        timestamp,
        signature: sign(timestamp, body),
        signingSecret: SECRET,
        now,
      }).ok,
    ).toBe(false);
  });
});

describe("parseWebhookPayload", () => {
  it("parses valid envelopes", () => {
    const event = parseWebhookPayload(
      JSON.stringify({ event_type: "message.received", event_id: "abc", data: {} }),
    );
    expect(event.event_type).toBe("message.received");
  });

  it("throws on invalid input", () => {
    expect(() => parseWebhookPayload("not json")).toThrow(ValidationError);
    expect(() => parseWebhookPayload(JSON.stringify({}))).toThrow(ValidationError);
  });
});
