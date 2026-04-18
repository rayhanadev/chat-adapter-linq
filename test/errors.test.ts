import { describe, expect, it } from "vitest";
import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import { mapHttpError, wrapNetworkError } from "../src/errors.js";

const body = { success: false, error: { status: 0, code: 1234, message: "boom" } } as const;

describe("mapHttpError", () => {
  it("maps HTTP statuses to typed adapter errors", () => {
    expect(mapHttpError({ status: 401, body })).toBeInstanceOf(AuthenticationError);
    expect(mapHttpError({ status: 403, body })).toBeInstanceOf(PermissionError);
    expect(mapHttpError({ status: 404, body })).toBeInstanceOf(ResourceNotFoundError);
    expect(mapHttpError({ status: 400, body })).toBeInstanceOf(ValidationError);
    expect(mapHttpError({ status: 500, body })).toBeInstanceOf(NetworkError);
    expect(mapHttpError({ status: 418, body })).toBeInstanceOf(AdapterError);
  });

  it("propagates retry-after on 429 responses", () => {
    const err = mapHttpError({ status: 429, body, retryAfter: 30 });
    expect(err).toBeInstanceOf(AdapterRateLimitError);
    expect((err as AdapterRateLimitError).retryAfter).toBe(30);
  });
});

describe("wrapNetworkError", () => {
  it("wraps Error and non-Error throwables", () => {
    expect(wrapNetworkError(new Error("boom"))).toBeInstanceOf(NetworkError);
    expect(wrapNetworkError("plain")).toBeInstanceOf(NetworkError);
  });
});
