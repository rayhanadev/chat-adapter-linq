import { describe, expect, it, vi } from "vitest";
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import { LinqClient } from "../src/client.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("LinqClient", () => {
  it("sends Bearer auth and parses JSON", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      expect(headers.authorization).toBe("Bearer test-key");
      return jsonResponse({ phone_numbers: [{ id: "1", phone_number: "+12025551234" }] });
    });
    const client = new LinqClient({
      apiKey: "test-key",
      signingSecret: "s",
      defaultFrom: "+1",
      fetch: fetchImpl,
    });
    const result = await client.listPhoneNumbers();
    expect(result.phone_numbers[0]?.phone_number).toBe("+12025551234");
  });

  it("serializes query params", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      expect(url.searchParams.get("from")).toBe("+1");
      expect(url.searchParams.get("limit")).toBe("5");
      return jsonResponse({ chats: [], next_cursor: null });
    });
    const client = new LinqClient({
      apiKey: "k",
      signingSecret: "s",
      defaultFrom: "+1",
      fetch: fetchImpl,
    });
    await client.listChats({ from: "+1", limit: 5 });
  });

  it("maps HTTP errors to typed adapter errors", async () => {
    const cases: Array<[number, unknown]> = [
      [401, AuthenticationError],
      [403, PermissionError],
      [404, ResourceNotFoundError],
      [400, ValidationError],
      [500, NetworkError],
    ];
    for (const [status, ErrorClass] of cases) {
      const client = new LinqClient({
        apiKey: "k",
        signingSecret: "s",
        defaultFrom: "+1",
        fetch: vi.fn(async () =>
          jsonResponse({ success: false, error: { status, code: 1, message: "x" } }, status),
        ),
      });
      await expect(client.listPhoneNumbers()).rejects.toBeInstanceOf(ErrorClass as never);
    }
  });

  it("propagates Retry-After on 429 responses", async () => {
    const client = new LinqClient({
      apiKey: "k",
      signingSecret: "s",
      defaultFrom: "+1",
      fetch: vi.fn(async () =>
        jsonResponse({ success: false, error: { status: 429, code: 1007, message: "slow" } }, 429, {
          "retry-after": "12",
        }),
      ),
    });
    const err = await client.listPhoneNumbers().catch((e) => e);
    expect(err).toBeInstanceOf(AdapterRateLimitError);
    expect((err as AdapterRateLimitError).retryAfter).toBe(12);
  });

  it("wraps fetch failures as NetworkError", async () => {
    const client = new LinqClient({
      apiKey: "k",
      signingSecret: "s",
      defaultFrom: "+1",
      fetch: vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    });
    await expect(client.listPhoneNumbers()).rejects.toBeInstanceOf(NetworkError);
  });
});
