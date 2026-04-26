import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import { ADAPTER_NAME } from "./types.js";

export function mapHttpError(opts: {
  status: number;
  body: unknown;
  retryAfter?: number;
}): AdapterError {
  const { status, body, retryAfter } = opts;
  const message = extractMessage(body) ?? `Linq API error (status ${status})`;
  const code = extractCode(body);

  switch (status) {
    case 401:
      return new AuthenticationError(ADAPTER_NAME, message);
    case 403:
      return new PermissionError(ADAPTER_NAME, message, code);
    case 404:
      return new ResourceNotFoundError(ADAPTER_NAME, "resource", code);
    case 429: {
      const error = new AdapterRateLimitError(ADAPTER_NAME, retryAfter ?? extractRetryAfter(body));
      (error as { message: string }).message = message;
      return error;
    }
    case 400:
    case 422:
      return new ValidationError(ADAPTER_NAME, message);
    default:
      if (status >= 500) {
        return new NetworkError(ADAPTER_NAME, message);
      }
      return new AdapterError(message, ADAPTER_NAME, code);
  }
}

export function wrapNetworkError(err: unknown): NetworkError {
  if (err instanceof Error) {
    return new NetworkError(ADAPTER_NAME, err.message, err);
  }
  return new NetworkError(ADAPTER_NAME, String(err));
}

function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: { message?: unknown } }).error;
  if (error && typeof error.message === "string") return error.message;
  return undefined;
}

function extractCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: { code?: unknown } }).error;
  if (error && (typeof error.code === "number" || typeof error.code === "string")) {
    return String(error.code);
  }
  return undefined;
}

function extractRetryAfter(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: { retry_after?: unknown } }).error;
  if (error && typeof error.retry_after === "number") return error.retry_after;
  return undefined;
}
