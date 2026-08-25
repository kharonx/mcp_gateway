import { z } from "zod";
import type { EndpointDef } from "../types.js";

const ITEM_SELECT =
  "id,name,size,webUrl,createdDateTime,lastModifiedDateTime,createdBy,lastModifiedBy,file,folder,parentReference";

export const onedriveEndpoints: EndpointDef[] = [
  {
    name: "get-my-drive",
    description: "Get the signed-in user's OneDrive (drive id, quota, owner).",
    toolset: "onedrive",
    scopes: ["Files.Read"],
    method: "GET",
    path: "/me/drive",
    resourceType: "drive",
  },
  {
    name: "list-my-drive-root-items",
    description: "List files/folders in the root of the user's OneDrive.",
    toolset: "onedrive",
    scopes: ["Files.Read"],
    method: "GET",
    path: "/me/drive/root/children",
    resourceType: "driveItem",
    paginated: true,
    defaultSelect: ITEM_SELECT,
    query: { filter: true, orderby: true, select: true },
    sourceType: "driveItem",
  },
  {
    name: "list-my-drive-folder-items",
    description: "List files/folders inside a OneDrive folder.",
    toolset: "onedrive",
    scopes: ["Files.Read"],
    method: "GET",
    path: "/me/drive/items/{itemId}/children",
    resourceType: "driveItem",
    paginated: true,
    defaultSelect: ITEM_SELECT,
    query: { filter: true, orderby: true, select: true },
    sourceType: "driveItem",
  },
  {
    name: "get-my-drive-item",
    description: "Get OneDrive file/folder metadata (includes @microsoft.graph.downloadUrl for files).",
    toolset: "onedrive",
    scopes: ["Files.Read"],
    method: "GET",
    path: "/me/drive/items/{itemId}",
    resourceType: "driveItem",
    sourceType: "driveItem",
  },
  {
    name: "get-my-drive-item-download-url",
    description: "Get a short-lived direct download URL for a OneDrive file without fetching its content.",
    toolset: "onedrive",
    scopes: ["Files.Read"],
    method: "GET",
    path: "/me/drive/items/{itemId}",
    resourceType: "driveItem",
    transform: (data) => ({
      id: (data as any)?.id,
      name: (data as any)?.name,
      size: (data as any)?.size,
      downloadUrl: (data as any)?.["@microsoft.graph.downloadUrl"] ?? null,
      note: (data as any)?.["@microsoft.graph.downloadUrl"]
        ? "The download URL is pre-authenticated and expires after a short time."
        : "No download URL (item may be a folder).",
    }),
  },
  {
    name: "search-my-drive",
    description: "Search the user's OneDrive (and items shared with them) by keyword.",
    toolset: "onedrive",
    scopes: ["Files.Read"],
    method: "GET",
    path: "/me/drive/root/search(q='{q}')",
    pathParamDescriptions: { q: "Search keyword" },
    resourceType: "driveItem",
    paginated: true,
    defaultSelect: ITEM_SELECT,
    sourceType: "driveItem",
  },
  {
    name: "download-my-drive-item",
    description:
      "Download a OneDrive file's content. DOCX/XLSX/PPTX/PDF/TXT/CSV are converted to text; other binaries come back as base64. Size-limited by MAX_DOWNLOAD_BYTES.",
    toolset: "onedrive",
    scopes: ["Files.Read"],
    method: "GET",
    path: "/me/drive/items/{itemId}/content",
    resourceType: "driveItem",
    binary: true,
    extraInput: {
      fileName: z.string().optional().describe("File name (helps pick the right text extractor)"),
    },
  },
];
