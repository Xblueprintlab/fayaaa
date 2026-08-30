export type PersistedVideoSettings = {
  ratio: "16:9" | "1:1" | "9:16";
  fps: 24 | 30 | 60;
  quality: "standard" | "high" | "max";
  frameX: number;
  frameY: number;
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

const SETTINGS_KEY = "fayaaa.playground.settings.v1";
const ASSET_DB = "fayaaa-playground";
const ASSET_STORE = "assets";

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
  const database = await openAssetDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(ASSET_STORE, "readwrite");
    transaction.objectStore(ASSET_STORE).put({ blob, name }, kind);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  database.close();
}

export async function loadPlaygroundAsset(
  kind: PersistedAssetKind,
): Promise<{ blob: Blob; name: string } | undefined> {
  const database = await openAssetDatabase();
  if (!database) return undefined;
  const asset = await new Promise<{ blob: Blob; name: string } | undefined>((resolve) => {
    const request = database.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).get(kind);
    request.onsuccess = () => resolve(request.result as { blob: Blob; name: string } | undefined);
    request.onerror = () => resolve(undefined);
  });
  database.close();
  return asset;
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
