import { describe, expect, it, vi } from "vitest";
import { fileDataToBuffer, uploadFile } from "../src/attachments.js";
import { LinqClient } from "../src/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fileDataToBuffer", () => {
  it("passes Buffer through, converts ArrayBuffer and Blob", async () => {
    const buf = Buffer.from("hello");
    expect(await fileDataToBuffer(buf)).toBe(buf);

    const ab = new TextEncoder().encode("hi").buffer as ArrayBuffer;
    expect((await fileDataToBuffer(ab)).toString()).toBe("hi");

    const blob = new Blob(["blob-data"]);
    expect((await fileDataToBuffer(blob)).toString()).toBe("blob-data");
  });

  it("rejects unsupported types", async () => {
    await expect(fileDataToBuffer(123 as unknown as Buffer)).rejects.toThrow();
  });
});

describe("uploadFile", () => {
  it("requests an upload URL, PUTs bytes, and returns a media part", async () => {
    let put: { url: string; method: string; body?: BodyInit | null } | null = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v3/attachments")) {
        return jsonResponse({
          attachment_id: "att-1",
          upload_url: "https://uploads.example.com/file",
          download_url: "https://cdn.linqapp.com/x.jpg",
          http_method: "PUT",
          expires_at: "2099-01-01T00:00:00Z",
          required_headers: { "Content-Type": "image/jpeg", "Content-Length": "5" },
        });
      }
      put = { url, method: init?.method ?? "GET", body: init?.body };
      return new Response(null, { status: 200 });
    });
    const client = new LinqClient({
      apiKey: "k",
      signingSecret: "s",
      defaultFrom: "+1",
      fetch: fetchImpl,
    });

    const part = await uploadFile(client, { data: Buffer.from("hello"), filename: "photo.jpg" });
    expect(part).toEqual({
      type: "media",
      attachment_id: "att-1",
      filename: "photo.jpg",
      mime_type: "image/jpeg",
      size_bytes: 5,
    });
    expect(put?.method).toBe("PUT");
    expect(put?.url).toBe("https://uploads.example.com/file");
  });

  it("infers mime type from extension when not provided", async () => {
    let captured: { content_type?: string } | undefined;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v3/attachments")) {
        captured = JSON.parse(init?.body as string) as { content_type?: string };
        return jsonResponse({
          attachment_id: "att-1",
          upload_url: "https://uploads.example.com/file",
          download_url: "https://cdn.linqapp.com/x",
          http_method: "PUT",
          expires_at: "2099-01-01T00:00:00Z",
          required_headers: { "Content-Type": captured.content_type ?? "", "Content-Length": "1" },
        });
      }
      return new Response(null, { status: 200 });
    });
    const client = new LinqClient({
      apiKey: "k",
      signingSecret: "s",
      defaultFrom: "+1",
      fetch: fetchImpl,
    });
    await uploadFile(client, { data: Buffer.from("x"), filename: "video.mp4" });
    expect(captured?.content_type).toBe("video/mp4");
  });
});
