export type RecordType =
  | "treatment"
  | "inspection"
  | "harvest"
  | "feeding"
  | "hygiene"
  | "disease"
  | "apiary"
  | "colony"
  | "queenSeries"
  | "queen"
  | "note";

export type BeeRecord = {
  id: string;
  type: RecordType;
  eventDate: string;
  title: string;
  payload: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
};

export type Attachment = {
  id: string;
  recordId: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
};

type StoredAttachment = Attachment & { blob: Blob };
type MetaRow = { key: string; value: unknown };

export type BackupFile = {
  app: "BienenDoku Pflicht";
  version: 2;
  storage: "device-local";
  exportedAt: string;
  records: BeeRecord[];
  attachments: Array<Attachment & { dataUrl: string }>;
};

const DB_NAME = "bienen-doku-pflicht";
const DB_VERSION = 1;
const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "jpg", "jpeg", "png", "webp", "heic", "heif", "txt", "csv", "xml", "doc", "docx", "xls", "xlsx",
]);

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Lokaler Speicherfehler."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Lokaler Speicherfehler."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Speichervorgang abgebrochen."));
  });
}

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Dieser Browser unterstützt den lokalen App-Speicher nicht."));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("records")) {
        const store = database.createObjectStore("records", { keyPath: "id" });
        store.createIndex("eventDate", "eventDate");
        store.createIndex("type", "type");
      }
      if (!database.objectStoreNames.contains("attachments")) {
        const store = database.createObjectStore("attachments", { keyPath: "id" });
        store.createIndex("recordId", "recordId");
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Lokaler App-Speicher konnte nicht geöffnet werden."));
  });
}

function safeFileName(name: string) {
  const normalized = name.normalize("NFC").replace(/[\\/\u0000-\u001f\u007f]/g, "-").replace(/\s+/g, " ").trim();
  return (normalized || "beleg").slice(0, 180);
}

function validateFiles(files: File[]) {
  if (!files.length || files.length > MAX_FILES) throw new Error(`Bitte 1 bis ${MAX_FILES} Dateien auswählen.`);
  if (files.some((file) => file.size > MAX_FILE_SIZE)) throw new Error("Eine Datei ist größer als 10 MB.");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) throw new Error("Die Dateien sind zusammen größer als 25 MB.");
  if (files.some((file) => !ALLOWED_EXTENSIONS.has(file.name.split(".").pop()?.toLocaleLowerCase() ?? ""))) {
    throw new Error("Erlaubt sind PDF, Bilder, Text, CSV, XML sowie Word- und Excel-Dateien.");
  }
}

export async function listRecords() {
  const database = await openDatabase();
  try {
    const rows = await requestResult(database.transaction("records", "readonly").objectStore("records").getAll()) as BeeRecord[];
    return rows.sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt));
  } finally {
    database.close();
  }
}

export async function putRecord(record: BeeRecord) {
  const database = await openDatabase();
  const transaction = database.transaction("records", "readwrite");
  transaction.objectStore("records").put(record);
  await transactionDone(transaction);
  database.close();
  return record;
}

export async function deleteRecord(recordId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(["records", "attachments"], "readwrite");
  transaction.objectStore("records").delete(recordId);
  const attachmentStore = transaction.objectStore("attachments");
  const keys = await requestResult(attachmentStore.index("recordId").getAllKeys(recordId));
  keys.forEach((key) => attachmentStore.delete(key));
  await transactionDone(transaction);
  database.close();
}

export async function addAttachments(recordId: string, files: File[]) {
  if (!files.length) return [];
  validateFiles(files);
  const database = await openDatabase();
  const transaction = database.transaction("attachments", "readwrite");
  const store = transaction.objectStore("attachments");
  const created = files.map((file) => {
    const attachment: StoredAttachment = {
      id: crypto.randomUUID(),
      recordId,
      fileName: safeFileName(file.name),
      contentType: file.type || "application/octet-stream",
      size: file.size,
      createdAt: new Date().toISOString(),
      blob: file,
    };
    store.put(attachment);
    return {
      id: attachment.id,
      recordId: attachment.recordId,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      size: attachment.size,
      createdAt: attachment.createdAt,
    } satisfies Attachment;
  });
  await transactionDone(transaction);
  database.close();
  return created;
}

export async function listAttachments(recordId: string) {
  const database = await openDatabase();
  try {
    const rows = await requestResult(database.transaction("attachments", "readonly").objectStore("attachments").index("recordId").getAll(recordId)) as StoredAttachment[];
    return rows
      .map((row) => ({
        id: row.id,
        recordId: row.recordId,
        fileName: row.fileName,
        contentType: row.contentType,
        size: row.size,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    database.close();
  }
}

export async function getAttachment(attachmentId: string) {
  const database = await openDatabase();
  try {
    return await requestResult(database.transaction("attachments", "readonly").objectStore("attachments").get(attachmentId)) as StoredAttachment | undefined;
  } finally {
    database.close();
  }
}

export async function deleteAttachment(attachmentId: string) {
  const database = await openDatabase();
  const transaction = database.transaction("attachments", "readwrite");
  transaction.objectStore("attachments").delete(attachmentId);
  await transactionDone(transaction);
  database.close();
}

export async function getMeta<T>(key: string) {
  const database = await openDatabase();
  try {
    const row = await requestResult(database.transaction("meta", "readonly").objectStore("meta").get(key)) as MetaRow | undefined;
    return row?.value as T | undefined;
  } finally {
    database.close();
  }
}

export async function putMeta(key: string, value: unknown) {
  const database = await openDatabase();
  const transaction = database.transaction("meta", "readwrite");
  transaction.objectStore("meta").put({ key, value } satisfies MetaRow);
  await transactionDone(transaction);
  database.close();
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Datei konnte nicht gesichert werden."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(value: string) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value);
  if (!match) throw new Error("Eine Belegdatei im Backup ist ungültig.");
  const contentType = match[1] || "application/octet-stream";
  const bytes = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const output = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) output[index] = bytes.charCodeAt(index);
  return new Blob([output], { type: contentType });
}

export async function createBackup(): Promise<BackupFile> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["records", "attachments"], "readonly");
    const recordsPromise = requestResult(transaction.objectStore("records").getAll()) as Promise<BeeRecord[]>;
    const attachmentsPromise = requestResult(transaction.objectStore("attachments").getAll()) as Promise<StoredAttachment[]>;
    const [records, storedAttachments] = await Promise.all([recordsPromise, attachmentsPromise]);
    const attachments = await Promise.all(storedAttachments.map(async ({ blob, ...metadata }) => ({
      ...metadata,
      dataUrl: await blobToDataUrl(blob),
    })));
    return {
      app: "BienenDoku Pflicht",
      version: 2,
      storage: "device-local",
      exportedAt: new Date().toISOString(),
      records,
      attachments,
    };
  } finally {
    database.close();
  }
}

export async function restoreBackup(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Die Sicherungsdatei ist ungültig.");
  const backup = value as Partial<BackupFile>;
  if (backup.app !== "BienenDoku Pflicht" || backup.version !== 2 || !Array.isArray(backup.records) || !Array.isArray(backup.attachments)) {
    throw new Error("Bitte eine vollständige Bienen-Doku-Sicherung der Version 2 auswählen.");
  }
  const recordIds = new Set(backup.records.map((record) => record?.id));
  if (backup.records.some((record) => !record?.id || !record?.type || !record?.eventDate || !record?.title)) {
    throw new Error("Mindestens ein Datensatz im Backup ist unvollständig.");
  }
  if (backup.attachments.some((item) => !item?.id || !item.recordId || !recordIds.has(item.recordId) || !item.dataUrl)) {
    throw new Error("Mindestens ein Beleg im Backup ist unvollständig oder nicht zuordenbar.");
  }

  const attachments: StoredAttachment[] = backup.attachments.map(({ dataUrl, ...metadata }) => {
    const blob = dataUrlToBlob(dataUrl);
    if (blob.size > MAX_FILE_SIZE) throw new Error(`„${metadata.fileName}“ ist größer als 10 MB.`);
    return { ...metadata, size: blob.size, blob };
  });
  const database = await openDatabase();
  const transaction = database.transaction(["records", "attachments"], "readwrite");
  const recordStore = transaction.objectStore("records");
  const existingRecords = await requestResult(recordStore.getAll()) as BeeRecord[];
  const existingById = new Map(existingRecords.map((record) => [record.id, record]));
  backup.records.forEach((record) => {
    const existing = existingById.get(record.id);
    if (!existing || record.updatedAt >= existing.updatedAt) recordStore.put(record);
  });
  attachments.forEach((attachment) => transaction.objectStore("attachments").put(attachment));
  await transactionDone(transaction);
  database.close();
  return { records: backup.records.length, attachments: attachments.length };
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
