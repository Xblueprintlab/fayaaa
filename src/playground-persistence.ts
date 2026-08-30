export type PersistedVideoSettings = {
  kind?: "image" | "video";
  ratio: "16:9" | "1:1" | "4:5" | "9:16";
  fps: 24 | 30 | 60;
  quality: "standard" | "high" | "max";
  duration?: 3 | 5 | 10;
  frameX: number;
  frameY: number;
  scale?: number;
};

export type PersistedPlaygroundSettings = {
  version: 1;
  subjectKind: "image" | "text";
  text: string;
  subjectColor: string;
  backgroundMode: "color" | "image" | "transparent";
  backgroundColor: string;
  look: "fire" | "plasma" | "ghost";
  blend: string;
  paused: boolean;
  video: PersistedVideoSettings;
};

export type PersistedAssetKind = "subject" | "background";

export type PersistedPlaygroundAsset = {
  version: 2;
  blob: Blob;
  name: string;
};

export type LoadedPlaygroundAsset = PersistedPlaygroundAsset | {
  version: 1;
  blob: Blob;
  name: string;
};

const SETTINGS_KEY = "fayaaa.playground.settings.v1";
const ASSET_DB = "fayaaa-playground";
const ASSET_STORE = "assets";
export const MAX_PERSISTED_ASSET_BYTES = 8 * 1024 * 1024;

export function isPersistedPlaygroundAsset(value: unknown): value is PersistedPlaygroundAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<PersistedPlaygroundAsset>;
  return asset.version === 2
    && asset.blob instanceof Blob
    && asset.blob.type === "image/png"
    && asset.blob.size > 0
    && asset.blob.size <= MAX_PERSISTED_ASSET_BYTES
    && typeof asset.name === "string"
    && asset.name.length > 0
    && asset.name.length <= 255;
}

function isLegacyPlaygroundAsset(value: unknown): value is { blob: Blob; name: string } {
  if (!value || typeof value !== "object") return false;
  const asset = value as { blob?: unknown; name?: unknown };
  return asset.blob instanceof Blob
    && asset.blob.size > 0
    && asset.blob.size <= MAX_PERSISTED_ASSET_BYTES
    && typeof asset.name === "string"
    && asset.name.length > 0
    && asset.name.length <= 255;
}

export function normalizeLoadedPlaygroundAsset(value: unknown): LoadedPlaygroundAsset | undefined {
  if (isPersistedPlaygroundAsset(value)) return value;
  if (isLegacyPlaygroundAsset(value)) return { version: 1, blob: value.blob, name: value.name };
  return undefined;
}

export function loadPlaygroundSettings(): Partial<PersistedPlaygroundSettings> {
  try {
    const value = localStorage.getItem(SETTINGS_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value) as Partial<PersistedPlaygroundSettings>;
    return parsed.version === 1 ? parsed : {};
  } catch {
    return {};
  }
}

export function savePlaygroundSettings(settings: PersistedPlaygroundSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // The playground still works when storage is blocked or full.
  }
}

function openAssetDatabase(): Promise<IDBDatabase | undefined> {
  if (!("indexedDB" in window)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const request = indexedDB.open(ASSET_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ASSET_STORE)) {
        request.result.createObjectStore(ASSET_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

export async function savePlaygroundAsset(
  kind: PersistedAssetKind,
  blob: Blob,
  name: string,
): Promise<void> {
  const asset: PersistedPlaygroundAsset = { version: 2, blob, name };
  if (!isPersistedPlaygroundAsset(asset)) throw new Error("Only bounded PNG assets can be persisted");
  const database = await openAssetDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(ASSET_STORE, "readwrite");
    transaction.objectStore(ASSET_STORE).put(asset, kind);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  database.close();
}

export async function loadPlaygroundAsset(
  kind: PersistedAssetKind,
): Promise<LoadedPlaygroundAsset | undefined> {
  const database = await openAssetDatabase();
  if (!database) return undefined;
  const asset = await new Promise<unknown>((resolve) => {
    const request = database.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).get(kind);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
  database.close();
  const normalized = normalizeLoadedPlaygroundAsset(asset);
  if (normalized) return normalized;
  if (asset !== undefined) await clearPlaygroundAsset(kind);
  return undefined;
}

export async function clearPlaygroundAsset(kind: PersistedAssetKind): Promise<void> {
  const database = await openAssetDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(ASSET_STORE, "readwrite");
    transaction.objectStore(ASSET_STORE).delete(kind);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  database.close();
}
