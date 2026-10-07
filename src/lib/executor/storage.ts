import fs from "node:fs";
import path from "node:path";
import type { AssetStorageProvider, StoredFile } from "@/lib/executor/types";

export function assetRoot() {
  const configured = process.env.ASSET_STORAGE_PATH?.trim() || path.join("data", "assets");
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function extension(mimeType: string) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "video/mp4") return "mp4";
  return "png";
}

export function mp4DurationSeconds(bytes: Buffer) {
  const index = bytes.indexOf("mvhd");
  if (index < 0 || index + 24 > bytes.length) return null;
  const version = bytes[index + 4];
  if (version !== 0) return null;
  const timescale = bytes.readUInt32BE(index + 16);
  const duration = bytes.readUInt32BE(index + 20);
  if (!timescale) return null;
  const seconds = duration / timescale;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 100) / 100;
}

function isMp4(bytes: Buffer) {
  return bytes.length > 12 && bytes.toString("ascii", 4, 8) === "ftyp";
}

export function sniffImage(bytes: Buffer): { mimeType: string; width: number | null; height: number | null } {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length - 8) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { mimeType: "image/jpeg", width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
    return { mimeType: "image/jpeg", width: null, height: null };
  }
  if (bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", width: null, height: null };
  }
  return { mimeType: "application/octet-stream", width: null, height: null };
}

export function localAssetStorage(): AssetStorageProvider {
  return {
    id: "local-files",
    root: assetRoot,
    write(assetId, bytes, mimeType) {
      if (mimeType === "video/mp4") {
        if (!isMp4(bytes)) throw new Error("The provider response was not an MP4 file.");
        const fileName = `${assetId}.mp4`;
        const root = assetRoot();
        const directory = path.join(root, "videos");
        fs.mkdirSync(directory, { recursive: true });
        const absolutePath = path.join(directory, fileName);
        const resolvedRoot = path.resolve(root);
        const resolvedFile = path.resolve(absolutePath);
        if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("The asset path left the storage directory.");
        fs.writeFileSync(resolvedFile, bytes);
        const stat = fs.statSync(resolvedFile);
        if (!stat.isFile() || stat.size < 1) throw new Error("The video file was not stored.");
        return { absolutePath: resolvedFile, fileName, mimeType: "video/mp4", fileSize: stat.size };
      }
      const sniffed = sniffImage(bytes);
      const mime = sniffed.mimeType === "application/octet-stream" ? mimeType : sniffed.mimeType;
      const fileName = `${assetId}.${extension(mime)}`;
      const root = assetRoot();
      fs.mkdirSync(root, { recursive: true });
      const absolutePath = path.join(root, fileName);
      const resolvedRoot = path.resolve(root);
      const resolvedFile = path.resolve(absolutePath);
      if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error("The asset path left the storage directory.");
      }
      fs.writeFileSync(resolvedFile, bytes);
      const stat = fs.statSync(resolvedFile);
      if (!stat.isFile() || stat.size < 1) throw new Error("The image file was not stored.");
      const stored: StoredFile = { absolutePath: resolvedFile, fileName, mimeType: mime, fileSize: stat.size };
      return stored;
    },
    read(absolutePath) {
      const safe = safePath(absolutePath);
      if (!safe || !fs.existsSync(safe)) return null;
      return fs.readFileSync(safe);
    },
    exists(absolutePath) {
      const safe = safePath(absolutePath);
      if (!safe) return false;
      try {
        return fs.statSync(safe).isFile() && fs.statSync(safe).size > 0;
      } catch {
        return false;
      }
    },
  };
}

export function safePath(absolutePath: string) {
  const root = path.resolve(assetRoot());
  const file = path.resolve(absolutePath);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null;
  return file;
}
