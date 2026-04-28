export type LocalMediaMetadata = {
  id: string;
  name: string;
  size: number;
  type: string;
  updatedAt: number;
};

type LocalMediaRecord = LocalMediaMetadata & {
  blob: Blob;
};

const DB_NAME = "screenmate-local-media";
const DB_VERSION = 1;
const STORE_NAME = "files";

export async function saveLocalMediaFile(file: File): Promise<LocalMediaMetadata> {
  const id = `local-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  const metadata: LocalMediaMetadata = {
    id,
    name: file.name,
    size: file.size,
    type: file.type,
    updatedAt: Date.now(),
  };
  const db = await openLocalMediaDb();
  await runStoreRequest(db, "readwrite", (store) =>
    store.put({ ...metadata, blob: file } satisfies LocalMediaRecord),
  );
  db.close();
  return metadata;
}

export async function readLocalMediaFile(
  id: string,
): Promise<(LocalMediaMetadata & { blob: Blob }) | null> {
  const db = await openLocalMediaDb();
  const record = await runStoreRequest<LocalMediaRecord | undefined>(
    db,
    "readonly",
    (store) => store.get(id),
  );
  db.close();
  return record ?? null;
}

export async function deleteLocalMediaFile(id: string): Promise<void> {
  const db = await openLocalMediaDb();
  await runStoreRequest(db, "readwrite", (store) => store.delete(id));
  db.close();
}

function openLocalMediaDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local media database."));
  });
}

function runStoreRequest<T = unknown>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = createRequest(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local media database request failed."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Local media database transaction failed."));
  });
}
