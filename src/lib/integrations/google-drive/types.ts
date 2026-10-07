export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string | null;
  webViewLink?: string | null;
  size?: string | null;
  parents?: string[];
};

export type DriveReader = {
  listChildren(parentId: string): Promise<DriveItem[]>;
  readText(item: DriveItem): Promise<{ text: string | null; mode: "text" | "metadata" }>;
};

export type DriveConnectionStatus = {
  status: "disconnected" | "connected" | "error";
  accountEmail: string | null;
  lastSync: string | null;
  lastError: string | null;
  filesIndexed: number;
  foldersIndexed: number;
  configured: boolean;
  scope: string;
};

export const TEXT_LIMIT = 60_000;
export const SYNC_FILE_LIMIT = 400;
