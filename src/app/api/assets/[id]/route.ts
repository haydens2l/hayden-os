import { getAsset } from "@/lib/executor/assets";
import { localAssetStorage } from "@/lib/executor/storage";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const asset = getAsset(getDb(), id);
  const storage = localAssetStorage();
  if (!asset?.storage_location || !asset.file_size || !storage.exists(asset.storage_location)) {
    return new Response("That file is not stored.", { status: 404 });
  }
  const bytes = storage.read(asset.storage_location);
  if (!bytes || bytes.length < 1) return new Response("That file is not stored.", { status: 404 });
  const type = asset.mime_type || "application/octet-stream";
  const range = request.headers.get("range");
  if (type.startsWith("video/") && range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : bytes.length - 1;
      if (start <= end && end < bytes.length) {
        const slice = bytes.subarray(start, end + 1);
        return new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            "Content-Type": type,
            "Content-Length": String(slice.length),
            "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
    }
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      "Accept-Ranges": type.startsWith("video/") ? "bytes" : "none",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
