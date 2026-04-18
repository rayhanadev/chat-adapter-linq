import { createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import {
  ADAPTER_NAME,
  type LinqMessageEditedEventDataV2,
  type LinqMessageEventDataV2,
  type LinqParticipantEventData,
  type LinqReactionEventData,
  type LinqTypingEventData,
  type LinqWebhookEnvelope,
} from "./types.js";

const DEFAULT_TOLERANCE_SEC = 300;

export interface VerifySignatureOpts {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  signingSecret: string;
  toleranceSec?: number;
  now?: () => number;
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing_headers" | "stale_timestamp" | "invalid_signature" | "malformed_timestamp";
    };

export function verifySignature(opts: VerifySignatureOpts): VerifyResult {
  const tolerance = opts.toleranceSec ?? DEFAULT_TOLERANCE_SEC;

  if (!opts.timestamp || !opts.signature) {
    return { ok: false, reason: "missing_headers" };
  }

  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "malformed_timestamp" };
  }

  const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  if (Math.abs(nowSec - ts) > tolerance) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const signed = `${opts.timestamp}.${opts.rawBody}`;
  const expectedHex = createHmac("sha256", opts.signingSecret).update(signed).digest("hex");

  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expectedHex, "hex");
    providedBuf = Buffer.from(opts.signature, "hex");
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }

  if (expectedBuf.length !== providedBuf.length || expectedBuf.length === 0) {
    return { ok: false, reason: "invalid_signature" };
  }

  return timingSafeEqual(expectedBuf, providedBuf)
    ? { ok: true }
    : { ok: false, reason: "invalid_signature" };
}

export type LinqWebhookEvent =
  | (LinqWebhookEnvelope<LinqMessageEventDataV2> & {
      event_type: "message.received" | "message.sent" | "message.delivered" | "message.read";
    })
  | (LinqWebhookEnvelope<LinqMessageEditedEventDataV2> & { event_type: "message.edited" })
  | (LinqWebhookEnvelope<LinqReactionEventData> & {
      event_type: "reaction.added" | "reaction.removed";
    })
  | (LinqWebhookEnvelope<LinqTypingEventData> & {
      event_type: "chat.typing_indicator.started" | "chat.typing_indicator.stopped";
    })
  | (LinqWebhookEnvelope<LinqParticipantEventData> & {
      event_type: "participant.added" | "participant.removed";
    })
  | (LinqWebhookEnvelope<unknown> & { event_type: string });

export function parseWebhookPayload(rawBody: string): LinqWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ValidationError(ADAPTER_NAME, "Webhook payload is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ValidationError(ADAPTER_NAME, "Webhook payload must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.event_type !== "string") {
    throw new ValidationError(ADAPTER_NAME, "Webhook payload missing event_type");
  }
  if (typeof obj.event_id !== "string") {
    throw new ValidationError(ADAPTER_NAME, "Webhook payload missing event_id");
  }
  return parsed as LinqWebhookEvent;
}
