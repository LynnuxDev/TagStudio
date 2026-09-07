import { User } from "../types";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.message || body.error || `HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function useApi() {
  return {
    // Auth
    signUp: (email: string, password: string, name?: string) =>
      request<{ user: User; session: unknown }>("/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      }),
    signIn: (email: string, password: string) =>
      request<{ user: User; session: unknown }>("/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    signOut: () =>
      request<null>("/auth/sign-out", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    getSession: () =>
      request<{ user: User; session: unknown } | null>("/auth/get-session"),

    // Files
    listDir: (path?: string, showHidden?: boolean) =>
      request<import("../types").DirListing>(
        `/files?path=${encodeURIComponent(path || "")}&showHidden=${showHidden ?? false}`,
      ),
    getFileInfo: (path: string) =>
      request<import("../types").FileEntry>(
        `/files/info?path=${encodeURIComponent(path)}`,
      ),
    getArchiveList: (path: string) =>
      request<{ files: string[] }>(
        `/files/archive/list?path=${encodeURIComponent(path)}`,
      ),

    // Metadata
    getMetadata: (path: string) =>
      request<import("../types").MetadataResponse>(
        `/metadata?path=${encodeURIComponent(path)}`,
      ),
    updateMetadata: (path: string, metadata: Record<string, unknown>) =>
      request<import("../types").MetadataResponse>(
        `/metadata?path=${encodeURIComponent(path)}`,
        {
          method: "PUT",
          body: JSON.stringify({ metadata }),
        },
      ),
    patchMetadata: (path: string, metadata: Record<string, unknown>) =>
      request<import("../types").MetadataResponse>(
        `/metadata?path=${encodeURIComponent(path)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ metadata }),
        },
      ),
    deleteMetadataKey: (path: string, key: string) =>
      request<import("../types").MetadataResponse>(
        `/metadata/${encodeURIComponent(key)}?path=${encodeURIComponent(path)}`,
        {
          method: "DELETE",
        },
      ),
    addTags: (path: string, tags: string[]) =>
      request<import("../types").MetadataResponse>(
        `/metadata/tags?path=${encodeURIComponent(path)}`,
        {
          method: "POST",
          body: JSON.stringify({ tags }),
        },
      ),
    removeTag: (path: string, tag: string) =>
      request<import("../types").MetadataResponse>(
        `/metadata/tags/${encodeURIComponent(tag)}?path=${encodeURIComponent(path)}`,
        {
          method: "DELETE",
        },
      ),

    // Search
    search: (params: { q?: string; key?: string; value?: string; extensions?: string; tags?: string }) => {
      const sp = new URLSearchParams();
      if (params.q) sp.set("q", params.q);
      if (params.key) sp.set("key", params.key);
      if (params.value) sp.set("value", params.value);
      if (params.extensions) sp.set("extensions", params.extensions);
      if (params.tags) sp.set("tags", params.tags);
      return request<{
        results: import("../types").SearchResult[];
        count: number;
      }>(`/search?${sp}`);
    },
    getTags: () => request<{ tags: string[] }>("/search/tags"),

    // File operations
    createFolder: (parentPath: string, name: string) =>
      request<{ path: string }>("/files/create-folder", {
        method: "POST",
        body: JSON.stringify({ parentPath, name }),
      }),
    createFile: (parentPath: string, name: string, overwrite?: boolean) =>
      request<{ path: string }>("/files/create-file", {
        method: "POST",
        body: JSON.stringify({ parentPath, name, overwrite: overwrite ?? false }),
      }),
    deleteFile: (path: string) =>
      request<{ success: boolean }>(`/files/delete?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
      }),
    renameFile: (filePath: string, name: string, overwrite?: boolean) =>
      request<{ path: string }>("/files/rename", {
        method: "POST",
        body: JSON.stringify({ path: filePath, name, overwrite: overwrite ?? false }),
      }),
    moveFile: (sourcePath: string, destinationPath: string) =>
      request<{ success: boolean }>("/files/move", {
        method: "POST",
        body: JSON.stringify({ source: sourcePath, destination: destinationPath }),
      }),
    saveTextFile: (filePath: string, content: string) =>
      request<{ success: boolean }>("/files/write-text", {
        method: "PUT",
        body: JSON.stringify({ path: filePath, content }),
      }),
    openWithMpv: (filePath: string) =>
      request<{ success: boolean }>("/files/open-with/mpv", {
        method: "POST",
        body: JSON.stringify({ path: filePath }),
      }),
    openWithYacreader: (filePath: string) =>
      request<{ success: boolean }>("/files/open-with/yacreader", {
        method: "POST",
        body: JSON.stringify({ path: filePath }),
      }),
    extractArchive: (filePath: string) =>
      request<{ success: boolean; output: string }>("/files/extract", {
        method: "POST",
        body: JSON.stringify({ path: filePath }),
      }),
    decryptRpgMaker: (filePath: string) =>
      request<{ success: boolean; output: string }>("/files/decrypt-rpgmaker", {
        method: "POST",
        body: JSON.stringify({ path: filePath }),
      }),
  };
}
