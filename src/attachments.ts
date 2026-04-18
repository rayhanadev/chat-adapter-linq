import type { FileUpload } from "chat";
import type { LinqClient } from "./client.js";
import type { LinqMediaPart } from "./types.js";

export interface UploadedFile {
  attachmentId: string;
  filename: string;
  mimeType?: string;
}

export async function uploadFile(client: LinqClient, file: FileUpload): Promise<LinqMediaPart> {
  const buffer = await fileDataToBuffer(file.data);
  const mimeType = file.mimeType ?? guessMimeType(file.filename) ?? "application/octet-stream";

  const upload = await client.requestUpload({
    filename: file.filename,
    content_type: mimeType,
    size_bytes: buffer.byteLength,
  });

  await client.putUpload(upload.upload_url, upload.required_headers, buffer);

  return {
    type: "media",
    attachment_id: upload.attachment_id,
    filename: file.filename,
    mime_type: mimeType,
    size_bytes: buffer.byteLength,
  };
}

export async function fileDataToBuffer(data: FileUpload["data"]): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  if (
    data &&
    typeof (data as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === "function"
  ) {
    return Buffer.from(await (data as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer());
  }
  throw new Error("Unsupported file data type for Linq attachment upload");
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  m4a: "audio/x-m4a",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  caf: "audio/x-caf",
  amr: "audio/amr",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  vcf: "text/vcard",
  ics: "text/calendar",
};

function guessMimeType(filename: string): string | undefined {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return undefined;
  const ext = filename.slice(idx + 1).toLowerCase();
  return MIME_BY_EXT[ext];
}
