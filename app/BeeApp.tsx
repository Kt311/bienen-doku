"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  DEFAULT_COMPLIANCE_CATALOG,
  getVarroaApplicationProfile,
  UPD_URL,
  VARROA_SOURCE_URL,
  type ComplianceCatalog,
  type VarroaProduct,
} from "../lib/varroa-products";
import {
  addAttachments,
  createBackup,
  deleteAttachment,
  deleteRecord,
  getAttachment,
  getMeta,
  listAttachments,
  listRecords,
  putMeta,
  putRecord,
  requestPersistentStorage,
  restoreBackup,
  type Attachment,
  type BackupFile,
  type BeeRecord,
  type RecordType,
} from "../lib/local-db";
import { createSyncCode, decryptBackup, encryptBackup, normalizeSyncCode, syncEndpointId, type EncryptedSyncPayload } from "../lib/sync";

type View = "dashboard" | "records" | "apiaries" | "breeding" | "export" | "legal" | "help";
type AutoBackupMode = "file" | "download" | null;
type AutoBackupStatus = "off" | "ready" | "saving" | "saved" | "permission" | "error";
type AutoBackupSettings = {
  mode: AutoBackupMode;
  fileName: string | null;
  lastBackupAt: string | null;
};
type SyncStatus = "off" | "ready" | "syncing" | "synced" | "offline" | "error";
type SourceCheck = { checkedAt: string; allReachable: boolean; sources: Array<{ title: string; ok: boolean }> };
type WritableBackupHandle = FileSystemFileHandle & {
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};
type BackupPickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<WritableBackupHandle>;
};

const labels: Record<RecordType, { label: string; short: string; icon: string; tone: string }> = {
  treatment: { label: "Behandlung", short: "Arzneimittel", icon: "✚", tone: "amber" },
  inspection: { label: "Durchsicht", short: "Volkskontrolle", icon: "⌕", tone: "green" },
  harvest: { label: "Honigernte", short: "Charge & Ernte", icon: "◐", tone: "gold" },
  feeding: { label: "Fütterung", short: "Futterherkunft", icon: "↗", tone: "blue" },
  hygiene: { label: "Hygiene", short: "Reinigung", icon: "✦", tone: "mint" },
  disease: { label: "Seuchenhinweis", short: "Meldedaten", icon: "!", tone: "red" },
  apiary: { label: "Bienenstand", short: "Standort & Meldung", icon: "⌂", tone: "green" },
  colony: { label: "Bienenvolk", short: "Volk & Beute", icon: "⬡", tone: "gold" },
  queenSeries: { label: "Zuchtserie", short: "Umlarven bis Schlupf", icon: "♛", tone: "gold" },
  queen: { label: "Königin", short: "Begattung & Bestand", icon: "♕", tone: "amber" },
  note: { label: "Notiz", short: "Gesprochen oder getippt", icon: "✎", tone: "blue" },
};

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function breedingDueLabel(value: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${value}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)} Tag${Math.abs(days) === 1 ? "" : "e"} überfällig`;
  if (days === 0) return "Heute fällig";
  if (days === 1) return "Morgen";
  return `in ${days} Tagen`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

function readableBackupHtml(backup: BackupFile) {
  const attachmentGroups = new Map<string, BackupFile["attachments"]>();
  backup.attachments.forEach((attachment) => attachmentGroups.set(attachment.recordId, [...(attachmentGroups.get(attachment.recordId) || []), attachment]));
  const embeddedBackup = JSON.stringify(backup).replace(/<\/script/gi, "<\\/script");
  const recordsHtml = backup.records.map((record, index) => {
    const fields = Object.entries(record.payload).filter(([, value]) => value !== "" && value !== null && value !== undefined).map(([key, value]) => `<div><dt>${escapeHtml(fieldNames[key] || key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
    const files = attachmentGroups.get(record.id) || [];
    const filesHtml = files.length ? files.map((file) => {
      const name = escapeHtml(file.fileName);
      if (file.contentType.startsWith("image/")) return `<figure><img src="${file.dataUrl}" alt="Beleg ${name}"><figcaption>${name} · ${escapeHtml(formatBytes(file.size))}</figcaption></figure>`;
      if (file.contentType === "application/pdf") return `<figure class="pdf"><object data="${file.dataUrl}" type="application/pdf"><a href="${file.dataUrl}" download="${name}">PDF-Beleg ${name} öffnen</a></object><figcaption>${name} · PDF · ${escapeHtml(formatBytes(file.size))}</figcaption></figure>`;
      return `<p class="document"><b>${name}</b><span>${escapeHtml(file.contentType || "Dokument")} · ${escapeHtml(formatBytes(file.size))}</span><a href="${file.dataUrl}" download="${name}">Dokument aus der Sicherung öffnen</a></p>`;
    }).join("") : "<p>Keine Belegdatei hinterlegt.</p>";
    return `<article><header><span>${String(index + 1).padStart(3, "0")}</span><div><small>${escapeHtml(labels[record.type].label)} · ${escapeHtml(formatDate(record.eventDate))}</small><h2>${escapeHtml(record.title)}</h2></div></header><dl>${fields}</dl><section class="files"><h3>Belege und Nachweise</h3>${filesHtml}</section><footer>Datensatz-ID: ${escapeHtml(record.id)}</footer></article>`;
  }).join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bienen Doku – sichtbare Sicherung</title><style>body{margin:0;background:#f7f4e9;color:#17352a;font:15px/1.5 Arial,sans-serif}main{width:min(960px,calc(100% - 28px));margin:auto;padding:32px 0}h1{font:700 38px Georgia,serif;margin:0}.intro{margin:8px 0 28px;color:#62736b}article{margin:0 0 24px;padding:24px;background:#fff;border:1px solid #d9d9c9;border-radius:18px;break-inside:avoid}article>header{display:grid;grid-template-columns:48px 1fr;gap:14px;align-items:center;border-bottom:2px solid #28704f;padding-bottom:14px}article>header>span{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#f0cf75;font-weight:900}small{color:#28704f;font-weight:800}h2{margin:3px 0 0;font:700 24px Georgia,serif}dl{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}dl div{padding:10px 0;border-bottom:1px solid #e5e8e2}dt{color:#6a7871;font-size:11px;font-weight:800;text-transform:uppercase}dd{margin:2px 0 0;white-space:pre-wrap}.files{margin-top:18px;padding:16px;background:#f2f6ed;border-radius:14px}.files h3{margin:0 0 12px}.files figure{margin:0 0 16px}.files img{display:block;max-width:100%;max-height:720px;margin:auto;border-radius:10px;object-fit:contain;background:white}.files object{display:block;width:100%;height:720px;border:1px solid #ccd5ce;border-radius:10px;background:white}.files figcaption{margin-top:7px;color:#607069;font-size:12px}.document{display:grid;gap:4px;padding:12px;background:#fff;border-radius:9px}.document a{color:#17633f;font-weight:800}article>footer{margin-top:14px;color:#718078;font-size:11px}@media(max-width:640px){main{padding-top:20px}h1{font-size:29px}article{padding:16px}dl{grid-template-columns:1fr}.files object{height:520px}}@media print{body{background:white}main{width:100%;padding:0}.intro{margin-bottom:10mm}article{border-radius:0;page-break-inside:auto}.files figure{break-inside:avoid}.files object{height:220mm}}</style></head><body><main><h1>Bienen Doku – sichtbare Sicherung</h1><p class="intro">Erstellt am ${escapeHtml(new Date(backup.exportedAt).toLocaleString("de-DE"))} · ${backup.records.length} Einträge · ${backup.attachments.length} Belege. Diese Datei enthält die sichtbaren Belege und die vollständigen Daten zur Wiederherstellung in der App.</p>${recordsHtml || "<p>Noch keine Einträge gespeichert.</p>"}</main><script id="bienendoku-backup" type="application/json">${embeddedBackup}</script></body></html>`;
}

function typicalBloomForGlt(value: number, dateValue: string) {
  const month = Number(dateValue.slice(5, 7));
  if (month >= 8) return "Heide, Goldrute, Efeu und späte Sommerblüher";
  if (value < 100) return "Hasel, Erle, Schneeglöckchen und Winterling";
  if (value < 200) return "Kornelkirsche, Huflattich und erste Weiden";
  if (value < 300) return "Salweide, Schlehe und frühe Kirschblüte";
  if (value < 450) return "Kirsche, Pflaume, Löwenzahn und Ahorn";
  if (value < 600) return "Apfel, Birne, Raps und Weißdorn";
  if (value < 800) return "Robinie, Holunder und Himbeere";
  if (value < 1000) return "Linde, Brombeere und Klee";
  return "Linde, Brombeere, Klee und weitere Sommertracht";
}

function beekeeperRoadmap(value: number | null, dateValue: string) {
  const month = Number(dateValue.slice(5, 7));
  if (month >= 11 || month <= 1) return { phase: "Winterruhe", focus: "Ruhe bewahren und von außen kontrollieren", tasks: ["Flugloch und Mäuseschutz prüfen", "Gewicht beziehungsweise Futterreserve beobachten", "Material und Zuchtplanung vorbereiten"] };
  if (month >= 9) return { phase: "Herbst und Einwinterung", focus: "Futter, Volksstärke und Winterruhe absichern", tasks: ["Futtervorrat und Volksstärke kontrollieren", "Varroa-Erfolg gemäß eigenem Konzept prüfen", "Schwache Einheiten beurteilen und Dokumentation abschließen"] };
  if (month >= 7 && (value ?? 1000) >= 850) return { phase: "Sommer und Trachtende", focus: "Ernte, Varroakontrolle und Einfütterung planen", tasks: ["Honigreife und Trachtende beurteilen", "Varroabefall kontrollieren und Maßnahmen planen", "Futterbedarf je Volk ermitteln"] };
  if (value === null) return { phase: "Jahreszeitlicher Fahrplan", focus: "PLZ eingeben, damit GLT und Vegetationsphase einfließen", tasks: ["Lokale Tracht beobachten", "Futtervorrat kontrollieren", "Nächste Durchsicht wetterabhängig planen"] };
  if (value < 100) return { phase: "Vorfrühling", focus: "Fluglochbeobachtung und Futterreserve", tasks: ["Reinigungsflug und Totenfall beobachten", "Futterreserve ohne unnötige Störung prüfen", "Boden und Flugloch freihalten"] };
  if (value < 200) return { phase: "Früher Brutbeginn", focus: "Futter und Volksentwicklung beobachten", tasks: ["Futterabriss vermeiden", "Weiselrichtigkeit nur bei geeignetem Wetter prüfen", "Böden und Windeln kontrollieren"] };
  if (value < 300) return { phase: "Weidenblüte", focus: "Brutentwicklung und Raumgefühl beurteilen", tasks: ["Brutnest und Futterkranz kontrollieren", "Schied und Raum an Volksstärke anpassen", "Drohnenrahmen und Material vorbereiten"] };
  if (value < 450) return { phase: "Frühtracht", focus: "Raum geben und Schwarmvorbereitung erkennen", tasks: ["Honigraum nach Volksstärke und Tracht geben", "Schwarmkontrollen vorbereiten", "Baurahmen und Brutbild prüfen"] };
  if (value < 650) return { phase: "Vollfrühling", focus: "Schwarmkontrolle und Honigraumführung", tasks: ["Regelmäßig auf Schwarmzellen kontrollieren", "Honigräume und Platzangebot anpassen", "Zuchtserien und Ablegerbildung planen"] };
  if (value < 850) return { phase: "Frühsommer", focus: "Tracht, Zucht und Varroamonitoring", tasks: ["Honigreife und Raum kontrollieren", "Begattungseinheiten und Königinnen prüfen", "Varroabefall dokumentieren"] };
  return { phase: "Sommer", focus: "Trachtende und nächste Betriebsphase vorbereiten", tasks: ["Trachtende und Honigreife beurteilen", "Varroakontrolle nach der Ernte planen", "Futter- und Materialbedarf berechnen"] };
}

function Field({ label, name, required, type = "text", placeholder, children }: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}{required && <b aria-hidden="true"> *</b>}</span>
      {children ?? <input name={name} type={type} required={required} placeholder={placeholder} />}
    </label>
  );
}

function takeFiles(form: FormData) {
  const files = form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);
  form.delete("attachments");
  return files;
}

function formPayload(form: FormData) {
  return Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)])) as Record<string, string>;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function treatmentError(payload: Record<string, string>, products: VarroaProduct[]) {
  const required = ["firstDate", "endDate", "product", "applicationMethod", "amount", "unit", "amountBasis", "applicationCount", "colonies", "colonyCount", "supplier", "supplierAddress", "proof", "withdrawalDays", "honeyRestriction", "leafletConfirmed"];
  if (required.some((key) => !payload[key]?.trim())) return "Ein Pflichtfeld des Arzneimittel-Nachweises fehlt.";
  if (!validDate(payload.firstDate) || !validDate(payload.endDate) || payload.endDate < payload.firstDate) {
    return "Das Behandlungsende darf nicht vor der ersten Verabreichung liegen.";
  }
  const product = products.find((entry) => entry.name === payload.product);
  if (!product) return "Bitte ein Präparat aus dem aktuellen Katalog wählen.";
  const profile = getVarroaApplicationProfile(product);
  if (!profile.units.includes(payload.unit)) return `Für ${product.name} ist die gewählte Einheit nicht vorgesehen.`;
  if (!profile.methods.includes(payload.applicationMethod)) return `Bitte eine passende Anwendungsart für ${product.name} wählen.`;
  if (profile.course === "repeat" && !payload.applicationDates?.trim()) return "Bitte die Wechsel- oder Wiederholungsdaten vollständig dokumentieren.";
  if (profile.course === "device" && !payload.applicationDevice?.trim()) return "Bitte die verwendete Applikationshilfe, das Gerät oder die Zubereitungsart angeben.";
  const amount = Number(payload.amount);
  const applicationCount = Number(payload.applicationCount);
  const colonyCount = Number(payload.colonyCount);
  const withdrawalDays = Number(payload.withdrawalDays);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(applicationCount) || applicationCount <= 0 || !Number.isInteger(colonyCount) || colonyCount <= 0 || !Number.isInteger(withdrawalDays) || withdrawalDays < 0) {
    return "Menge, Anwendungszahl und Völkerzahl müssen größer als 0 sein; die Wartezeit für Honig darf 0, aber nicht negativ sein.";
  }
  if (["Streifen", "Schalen"].includes(payload.unit) && !Number.isInteger(amount)) {
    return `${payload.unit} müssen als ganze Anzahl angegeben werden.`;
  }
  return null;
}

function UploadField() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  function syncFiles(files: File[]) {
    const input = inputRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    setSelectedFiles(files);
  }

  function addSelected(files: File[]) {
    const existing = new Set(selectedFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    const merged = [...selectedFiles];
    for (const file of files) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (!existing.has(key) && merged.length < 5) {
        merged.push(file);
        existing.add(key);
      }
    }
    syncFiles(merged);
  }

  return (
    <div className="upload-area">
      <div className="upload-field">
        <span className="upload-icon">↥</span>
        <span><b>Belege, Rechnungen oder Nachweise</b><small>Mehrfachauswahl möglich: bis zu 5 Dateien, je 10 MB; PDF, Bild, Text, CSV, XML, Word oder Excel.</small></span>
        <button className="button secondary compact" type="button" onClick={() => inputRef.current?.click()} disabled={selectedFiles.length >= 5}>{selectedFiles.length ? "Weitere Dateien" : "Dateien auswählen"}</button>
        <input ref={inputRef} className="hidden-file" name="attachments" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.txt,.csv,.xml,.doc,.docx,.xls,.xlsx" onChange={(event) => { addSelected(Array.from(event.target.files ?? [])); }} />
      </div>
      {selectedFiles.length > 0 && <div className="selected-file-list" aria-live="polite"><div className="selected-file-summary"><b>{selectedFiles.length} von 5 Dateien ausgewählt</b><button type="button" onClick={() => syncFiles([])}>Alle entfernen</button></div>{selectedFiles.map((file, index) => <div key={`${file.name}:${file.size}:${file.lastModified}`}><FileThumbnail blob={file} contentType={file.type} fileName={file.name} /><span><b>{file.name}</b><small>{formatBytes(file.size)}</small></span><button type="button" onClick={() => syncFiles(selectedFiles.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${file.name} aus der Auswahl entfernen`}>×</button></div>)}</div>}
    </div>
  );
}

function TreatmentForm({ products, catalog, onSaved, onCancel }: { products: VarroaProduct[]; catalog: ComplianceCatalog; onSaved: (record: BeeRecord, notice?: string) => void; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [productName, setProductName] = useState("");
  const [firstDate, setFirstDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [unit, setUnit] = useState("");
  const [applicationMethod, setApplicationMethod] = useState("");
  const selectedProduct = products.find((product) => product.name === productName);
  const selectedProfile = getVarroaApplicationProfile(selectedProduct);

  function selectProduct(name: string) {
    const product = products.find((entry) => entry.name === name);
    const profile = getVarroaApplicationProfile(product);
    setProductName(name);
    setUnit(profile.units[0]);
    setApplicationMethod(profile.methods[0]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const files = takeFiles(form);
    const payload = formPayload(form);
    try {
      const validationError = treatmentError(payload, products);
      if (validationError) throw new Error(validationError);
      const now = new Date().toISOString();
      const record: BeeRecord = {
        id: crypto.randomUUID(),
        type: "treatment",
        eventDate: payload.firstDate,
        title: `${payload.product || "Behandlung"} · ${payload.colonies || "Völker"}`,
        payload,
        createdAt: now,
        updatedAt: now,
      };
      await putRecord(record);
      try {
        await addAttachments(record.id, files);
        onSaved(record, files.length ? `${files.length} Datei${files.length === 1 ? "" : "en"} lokal zum Eintrag gespeichert.` : undefined);
      } catch (attachmentError) {
        onSaved(record, `Nachweis lokal gespeichert, aber der Beleg konnte nicht gespeichert werden: ${attachmentError instanceof Error ? attachmentError.message : "unbekannter Fehler"}`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="entry-form" onSubmit={submit}>
      <div className="form-heading">
        <div><span className="eyebrow">Pflichtnachweis</span><h2>Arzneimittel-Anwendung</h2></div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="Formular schließen">×</button>
      </div>
      <p className="form-note">Die mit * markierten Angaben bilden die Pflichtfelder nach Art. 108 VO (EU) 2019/6 ab.</p>
      <div className="form-grid">
        <Field label="Datum der ersten Verabreichung / Einlegen" name="firstDate" required><input name="firstDate" type="date" required value={firstDate} onChange={(event) => setFirstDate(event.target.value)} /></Field>
        <Field label={selectedProfile.course === "insert-remove" ? "Tatsächliche Entnahme / Behandlungsende" : selectedProfile.course === "repeat" ? "Tatsächliche letzte Anwendung / Behandlungsende" : "Tatsächliches Behandlungsende"} name="endDate" required><input name="endDate" type="date" required value={endDate} min={firstDate} onChange={(event) => setEndDate(event.target.value)} /></Field>
        <div className="wide-field">
          <Field label="Varroamittel aus der amtlichen LWG-Übersicht (Stand Juni 2025)" name="product" required>
            <select name="product" required value={productName} onChange={(event) => selectProduct(event.target.value)}>
              <option value="" disabled>Präparat auswählen</option>
              {(["Volk mit Brut", "Volk ohne Brut"] as const).map((state) => <optgroup key={state} label={state}>{products.filter((product) => product.colonyState === state).map((product) => <option key={product.name} value={product.name}>{product.name} · {product.activeIngredient}</option>)}</optgroup>)}
            </select>
          </Field>
          {selectedProduct && <><div className="product-info"><b>{selectedProduct.activeIngredient}</b><span>{selectedProduct.colonyState} · {selectedProduct.availability}</span><small><strong>{selectedProfile.dosageForm}</strong> · {selectedProfile.courseHint}{selectedProduct.note ? ` ${selectedProduct.note}` : ""}</small></div><div className="application-warning"><span>!</span><p>Die App passt Felder und Einheiten an das Präparat an, gibt aber keine Dosierung vor. Verbindlich bleiben aktuelle Packungsbeilage und Zulassungsstatus.</p></div></>}
          <input type="hidden" name="activeIngredient" value={selectedProduct?.activeIngredient ?? ""} />
          <input type="hidden" name="dosageForm" value={selectedProduct ? selectedProfile.dosageForm : ""} />
          <input type="hidden" name="productAvailability" value={selectedProduct?.availability ?? ""} />
          <input type="hidden" name="productColonyState" value={selectedProduct?.colonyState ?? ""} />
          <input type="hidden" name="productListSource" value={`Bienen Doku-Prüfkatalog ${catalog.version} · Produktliste ${catalog.productListDate}`} />
          <p className="source-note">Offline-Katalog {catalog.version}, geprüft am {new Date(`${catalog.verifiedAt}T12:00:00`).toLocaleDateString("de-DE")}. Die Liste kann gegenüber neuen oder ausgelaufenen Zulassungen zurückliegen. Vor jeder Anwendung <a href={UPD_URL} target="_blank" rel="noreferrer">aktuellen Zulassungsstatus</a> und aktuelle Packungsbeilage prüfen.</p>
        </div>
        <Field label="Grund / Indikation" name="indication"><input name="indication" defaultValue="Varroose" /></Field>
        <Field label="Anwendungsart" name="applicationMethod" required>
          <select name="applicationMethod" required disabled={!selectedProduct} value={applicationMethod} onChange={(event) => setApplicationMethod(event.target.value)}><option value="" disabled>Erst Präparat auswählen</option>{selectedProfile.methods.map((method) => <option key={method}>{method}</option>)}</select>
        </Field>
        <Field label={selectedProfile.amountLabel} name="amount" required><input name="amount" type="number" min={unit === "Streifen" || unit === "Schalen" ? "1" : "0.001"} step={unit === "Streifen" || unit === "Schalen" ? "1" : "any"} required disabled={!selectedProduct} placeholder={unit === "Streifen" ? "z. B. 2" : unit === "Schalen" ? "z. B. 1" : unit === "g" ? "z. B. 2" : "z. B. 50"} /></Field>
        <Field label="Passende Einheit" name="unit" required>
          <select name="unit" required disabled={!selectedProduct} value={unit} onChange={(event) => setUnit(event.target.value)}><option value="" disabled>Erst Präparat auswählen</option>{selectedProfile.units.map((item) => <option key={item}>{item}</option>)}</select>
        </Field>
        <Field label="Mengenangabe bezieht sich auf" name="amountBasis" required><select name="amountBasis" defaultValue="je Anwendung" required><option>je Anwendung</option><option>gesamt im Behandlungszeitraum</option></select></Field>
        <Field label="Anzahl Anwendungen / Einsätze" name="applicationCount" required><input name="applicationCount" type="number" min="1" step="1" required defaultValue="1" /></Field>
        {selectedProfile.course === "repeat" && <div className="wide-field"><Field label={selectedProfile.eventDatesLabel || "Daten weiterer Anwendungen"} name="applicationDates" required><textarea name="applicationDates" rows={2} required placeholder="z. B. 12.08.2026, 20.08.2026, 28.08.2026" /></Field></div>}
        {selectedProfile.course === "device" && <div className="wide-field"><Field label={selectedProfile.deviceLabel || "Applikationshilfe / Gerät"} name="applicationDevice" required placeholder="Bezeichnung des verwendeten Geräts oder der Zubereitung" /></div>}
        {selectedProfile.course === "insert-remove" && <Field label="Status am Behandlungsende" name="courseStatus" required><select name="courseStatus" defaultValue="Streifen vollständig entfernt" required><option>Streifen vollständig entfernt</option><option>Vorzeitig beendet und entfernt</option></select></Field>}
        <Field label="Behandelte Völker / Gruppe" name="colonies" required placeholder="z. B. KR-01 bis KR-08" />
        <Field label="Anzahl Völker" name="colonyCount" required><input name="colonyCount" type="number" min="1" step="1" required placeholder="8" /></Field>
        <Field label="Lieferant / Firma" name="supplier" required placeholder="Name" />
        <Field label="Anschrift Lieferant" name="supplierAddress" required placeholder="Straße, PLZ Ort" />
        <Field label="Erwerbsbeleg" name="proof" required placeholder="Rechnung / Belegnummer" />
        <Field label="Charge des Präparats" name="medicineBatch" placeholder="Chargen-/Lotnummer von Packung oder Beleg" />
        <Field label="Wartezeit für Honig laut Packungsbeilage (Tage, auch 0)" name="withdrawalDays" required><input name="withdrawalDays" type="number" min="0" step="1" required placeholder="0" /></Field>
        <div className="wide-field"><Field label="Zusätzliche Vorgabe zu Tracht / Honigräumen laut Packungsbeilage" name="honeyRestriction" required><textarea name="honeyRestriction" rows={2} required placeholder="z. B. nicht während der Tracht anwenden / Honigräume vorher entfernen / keine zusätzliche Vorgabe" /></Field><p className="source-note">Die Wartezeit beginnt nach der letzten Anwendung und betrifft die Gewinnung von Honig für den menschlichen Verzehr. Sie ist nicht die Behandlungsdauer oder Verweildauer von Streifen. Auch bei 0 Tagen können zusätzliche Tracht- oder Honigraumvorgaben gelten.</p></div>
        <Field label="Verschreibender Tierarzt" name="veterinarian" placeholder="Name und Kontakt, falls zutreffend" />
        <Field label="Anwender" name="appliedBy" placeholder="Name" />
        <div className="wide-field"><label className="confirmation-field"><input name="leafletConfirmed" type="checkbox" value="Ja" required /><span><b>Aktuellen Zulassungsstatus und aktuelle Packungsbeilage am Behandlungstag geprüft *</b><small>Dosierung, Anwendungsweg, Wartezeit für Honig sowie Tracht- und Honigraumvorgaben müssen aus der Packungsbeilage übernommen werden.</small></span></label></div>
      </div>
      <Field label="Bemerkung" name="notes"><textarea name="notes" rows={3} placeholder="Charge, Wetter, Besonderheiten …" /></Field>
      <UploadField />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button ghost" type="button" onClick={onCancel}>Abbrechen</button><button className="button primary" disabled={saving}>{saving ? "Speichert …" : "Pflichtnachweis speichern"}</button></div>
    </form>
  );
}

type FieldConfig = {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  min?: string;
  step?: string;
  placeholder?: string;
  options?: string[];
  wide?: boolean;
};

const hiveSystemOptions = [
  "Segeberger DNM 1.5",
  "Segeberger Deutsch Normalmaß (DNM)",
  "Deutsch Normalmaß (DNM)",
  "Deutsch Normalmaß 1.5 (DNM 1.5)",
  "Zander",
  "Zander 1.5",
  "Dadant US",
  "Dadant Blatt",
  "Langstroth",
  "Mini Plus",
  "Warré-Beute",
  "Einraumbeute",
  "Trogbeute",
  "Top-Bar-Hive",
  "BienenBox",
  "Hinterbehandlungsbeute",
  "Klotzbeute",
  "Sonstiges Beutensystem",
];

const formConfigs: Record<Exclude<RecordType, "treatment">, {
  kicker: string;
  note: string;
  titleField: string;
  fields: FieldConfig[];
}> = {
  inspection: {
    kicker: "Betriebsdokumentation",
    note: "Die Durchsicht ist nicht pauschal gesetzlich vorgeschrieben, hilft aber bei Tiergesundheit, Verlauf und Nachweisführung.",
    titleField: "colonies",
    fields: [
      { name: "eventDate", label: "Datum", type: "date", required: true },
      { name: "apiary", label: "Bienenstand", required: true, placeholder: "z. B. Krümmel" },
      { name: "colonies", label: "Volk / Völker", required: true, placeholder: "z. B. KR-01" },
      { name: "colonyCount", label: "Anzahl Völker", type: "number", required: true },
      { name: "hiveWeightKg", label: "Beutengewicht (kg)", type: "number", min: "0", step: "0.1", placeholder: "z. B. 42,5" },
      { name: "queenright", label: "Weiselrichtig", options: ["Ja", "Unsicher", "Nein"] },
      { name: "brood", label: "Brutbild", options: ["Geschlossen", "Lückig", "Keine Brut", "Nicht geprüft"] },
      { name: "stores", label: "Futtervorrat", options: ["Gut", "Knapp", "Kritisch", "Nicht geprüft"] },
      { name: "varroaMethod", label: "Varroa-Kontrolle", placeholder: "Windel, Puderzucker …" },
      { name: "varroaCount", label: "Milbenzahl / Ergebnis", placeholder: "Wert + Zeitraum" },
      { name: "diseaseSigns", label: "Krankheitsanzeichen", options: ["Keine", "Auffällig", "Verdacht – Meldung prüfen"] },
      { name: "action", label: "Maßnahme", placeholder: "Was wurde veranlasst?", wide: true },
      { name: "notes", label: "Bemerkung", placeholder: "Volksstärke, Schwarmstimmung …", wide: true },
    ],
  },
  harvest: {
    kicker: "Rückverfolgbarkeit",
    note: "Eine eindeutige Los-/Chargennummer verbindet Ernte, Verarbeitung, Lager und Abgabe.",
    titleField: "lot",
    fields: [
      { name: "eventDate", label: "Erntedatum", type: "date", required: true },
      { name: "lot", label: "Los / Charge", required: true, placeholder: "z. B. 2026-FS-01" },
      { name: "apiary", label: "Bienenstand", required: true },
      { name: "colonies", label: "Beteiligte Völker", required: true },
      { name: "honeyType", label: "Honig / Tracht", required: true, placeholder: "Frühtracht, Sommertracht …" },
      { name: "amountKg", label: "Menge in kg", type: "number", required: true },
      { name: "waterPercent", label: "Wassergehalt %", type: "number" },
      { name: "containers", label: "Gebinde / Hobbock", placeholder: "Nummern und Größen" },
      { name: "storageLocation", label: "Lagerort", required: true },
      { name: "recipient", label: "Abnehmer (falls Betrieb)", placeholder: "Name und Anschrift" },
      { name: "notes", label: "Bemerkung", wide: true },
    ],
  },
  feeding: {
    kicker: "Futter-Nachweis",
    note: "Für die Primärproduktion sind Art und Herkunft verfütterter Futtermittel relevant.",
    titleField: "colonies",
    fields: [
      { name: "eventDate", label: "Datum", type: "date", required: true },
      { name: "colonies", label: "Volk / Völker", required: true },
      { name: "feedName", label: "Futtermittel", required: true, placeholder: "Zucker, Sirup, Futterteig …" },
      { name: "feedOrigin", label: "Hersteller / Herkunft", required: true },
      { name: "batch", label: "Charge / Beleg", placeholder: "Chargennummer oder Rechnung" },
      { name: "amountKg", label: "Menge in kg", type: "number", required: true },
      { name: "ratio", label: "Mischungsverhältnis", placeholder: "z. B. 3:2" },
      { name: "notes", label: "Bemerkung", wide: true },
    ],
  },
  hygiene: {
    kicker: "Lebensmittelhygiene",
    note: "Dokumentiere Reinigung, Freigabe und Abweichungen im Schleuder-, Abfüll- oder Lagerbereich.",
    titleField: "area",
    fields: [
      { name: "eventDate", label: "Datum", type: "date", required: true },
      { name: "area", label: "Bereich / Gerät", required: true, placeholder: "Schleuderraum, Abfüller …" },
      { name: "measure", label: "Maßnahme", required: true, placeholder: "Reinigung, Sichtkontrolle …" },
      { name: "agent", label: "Reinigungsmittel", placeholder: "Produkt / Konzentration" },
      { name: "result", label: "Ergebnis / Freigabe", required: true, options: ["In Ordnung", "Nachreinigung", "Gesperrt"] },
      { name: "performedBy", label: "Durchgeführt von" },
      { name: "notes", label: "Abweichung / Korrektur", wide: true },
    ],
  },
  disease: {
    kicker: "Meldehilfe · keine automatische Meldung",
    note: "Bei Nachweis oder begründetem Verdacht unverzüglich die zuständige Behörde kontaktieren. Die App erstellt nur einen vollständigen Datensatz.",
    titleField: "disease",
    fields: [
      { name: "eventDate", label: "Datum der Feststellung", type: "date", required: true },
      { name: "disease", label: "Seuche / Verdacht", required: true, options: ["Varroose", "Amerikanische Faulbrut", "Kleiner Bienenbeutenkäfer", "Tropilaelaps-Milbe", "Sonstige"] },
      { name: "colonies", label: "Betroffene Völker", required: true },
      { name: "colonyCount", label: "Anzahl betroffener Völker", type: "number", required: true },
      { name: "reason", label: "Nachweis / Verdachtsgründe", required: true, wide: true },
      { name: "location", label: "Standort", required: true, placeholder: "Anschrift / Koordinaten" },
      { name: "otherColonies", label: "Weitere empfängliche Völker", type: "number", required: true },
      { name: "housing", label: "Haltungsform", required: true, placeholder: "Magazinbeuten, Freiaufstellung …" },
      { name: "authority", label: "Zuständige Behörde", placeholder: "Veterinäramt + Kontakt" },
      { name: "reporter", label: "Meldende Person", required: true },
      { name: "lab", label: "Untersuchungsstelle", placeholder: "Falls Probe untersucht" },
      { name: "testMethod", label: "Diagnosemethode / Ergebnis", placeholder: "Falls Probe untersucht" },
      { name: "action", label: "Sofortmaßnahmen / Meldung erfolgt", wide: true },
      { name: "notes", label: "Weitere Angaben", wide: true },
    ],
  },
  apiary: {
    kicker: "Stammdaten",
    note: "Bienenhaltung ist der zuständigen Behörde spätestens bei Tätigkeitsbeginn mit Völkerzahl und Standort anzuzeigen.",
    titleField: "name",
    fields: [
      { name: "eventDate", label: "Angelegt / gemeldet am", type: "date", required: true },
      { name: "name", label: "Name des Bienenstands", required: true, placeholder: "z. B. Krümmel Garten" },
      { name: "location", label: "Standort / Anschrift", required: true },
      { name: "coordinates", label: "Koordinaten", placeholder: "Optional" },
      { name: "registrationNumber", label: "Registriernummer", placeholder: "Behördliche Nummer" },
      { name: "authority", label: "Zuständige Behörde", placeholder: "Veterinäramt" },
      { name: "colonyCount", label: "Gemeldete Völkerzahl", type: "number", required: true },
      { name: "hiveSystem", label: "Beute / Kasten", options: hiveSystemOptions },
      { name: "notes", label: "Bemerkung", wide: true },
    ],
  },
  colony: {
    kicker: "Stammdaten",
    note: "Eine eindeutige Volksnummer erleichtert Behandlungen, Kontrollen, Ernten und Meldungen.",
    titleField: "colonyId",
    fields: [
      { name: "eventDate", label: "Angelegt am", type: "date", required: true },
      { name: "colonyId", label: "Volksnummer", required: true, placeholder: "z. B. KR-01" },
      { name: "apiary", label: "Bienenstand", required: true },
      { name: "hiveSystem", label: "Beute / Kasten", required: true, options: hiveSystemOptions },
      { name: "origin", label: "Herkunft", placeholder: "Ableger, Schwarm, Zukauf …" },
      { name: "queenYear", label: "Königin Jahrgang", type: "number" },
      { name: "status", label: "Status", required: true, options: ["Aktiv", "Ableger", "Aufgelöst", "Verkauft", "Verstorben"] },
      { name: "notes", label: "Bemerkung", wide: true },
    ],
  },
  queenSeries: {
    kicker: "Königinnenzucht · Zuchtserie",
    note: "Das Umlarvdatum ist der Ausgangspunkt. Die App berechnet daraus automatisch Annahmekontrolle, Verdeckelung, Käfigen und Schlupf.",
    titleField: "seriesName",
    fields: [
      { name: "eventDate", label: "Umlarvdatum", type: "date", required: true },
      { name: "seriesName", label: "Bezeichnung der Zuchtserie", required: true, placeholder: "z. B. ZS-2026-01" },
      { name: "breedingMethod", label: "Zuchtmethode", required: true, options: ["Umlarven", "Nicot/Jenter", "Schwarmzellen", "Nachschaffungszellen", "Sonstige"] },
      { name: "breedingMaterial", label: "Zuchtstoff", required: true, options: ["Eigene Königin", "Fremder Zuchtstoff"] },
      { name: "motherQueen", label: "Muttervolk / Zuchtbuchnummer", required: true },
      { name: "lineage", label: "Herkunft / Rasse / Linie", placeholder: "z. B. Carnica, Buckfast, Linie …" },
      { name: "graftedCount", label: "Umgelarvte Larven", type: "number", required: true },
      { name: "careColony", label: "Pflegevolk", required: true },
      { name: "careMethod", label: "Pflegeweise", required: true, options: ["Starter und Finisher", "Weiselloses Pflegevolk", "Anbrüter", "Über Starter im Honigraum", "Sonstige"] },
      { name: "acceptedCount", label: "Angenommene Zellen", type: "number" },
      { name: "incubator", label: "Wärmeschrank", options: ["Nein", "Ja"] },
      { name: "hatchedCount", label: "Geschlüpfte Königinnen", type: "number" },
      { name: "notes", label: "Bemerkungen / Ausfälle", wide: true },
    ],
  },
  queen: {
    kicker: "Königinnenzucht · Königin",
    note: "Dokumentiere Herkunft, Begattung, Zeichnung, Eiablage und aktuellen Verbleib jeder Königin.",
    titleField: "queenId",
    fields: [
      { name: "eventDate", label: "Schlupfdatum", type: "date", required: true },
      { name: "queenId", label: "Königinnen-Nummer", required: true, placeholder: "z. B. K-2026-01" },
      { name: "seriesName", label: "Zuchtserie", required: true },
      { name: "lineage", label: "Herkunft / Rasse / Linie" },
      { name: "matingUnit", label: "Begattungseinheit", required: true, options: ["Mini Plus", "Kieler Begattungskästchen", "Apidea", "Ableger", "Vollvolk", "Sonstige"] },
      { name: "matingType", label: "Begattung", required: true, options: ["Standbegattung", "Belegstelle", "Besamung"] },
      { name: "matingLocation", label: "Stand / Belegstelle" },
      { name: "introducedDate", label: "Eingesetzt am", type: "date" },
      { name: "matingStatus", label: "Begattungsstatus", required: true, options: ["Noch offen", "Begattet", "Unbegattet", "Verloren"] },
      { name: "layingSince", label: "In Eiablage seit", type: "date" },
      { name: "marked", label: "Gezeichnet", options: ["Nein", "Ja"] },
      { name: "markedDate", label: "Gezeichnet am", type: "date" },
      { name: "wingClipped", label: "Flügel geschnitten", options: ["Nein", "Ja"] },
      { name: "queenStatus", label: "Aktueller Status", required: true, options: ["Reserve", "Eingeweiselt", "Verkauft", "Abgegeben", "Verloren", "Tot"] },
      { name: "colonyId", label: "Aktuelles Volk" },
      { name: "notes", label: "Bemerkung / Leistungsbeobachtung", wide: true },
    ],
  },
  note: {
    kicker: "Freie Betriebsnotiz",
    note: "Notizen können normal eingetippt oder im Sprachmodus diktiert werden.",
    titleField: "noteTitle",
    fields: [
      { name: "eventDate", label: "Datum", type: "date", required: true },
      { name: "noteTitle", label: "Titel", required: true, placeholder: "z. B. Beobachtung am Stand" },
      { name: "apiary", label: "Bienenstand" },
      { name: "colonies", label: "Volk / Völker" },
      { name: "notes", label: "Notiz", required: true, wide: true },
    ],
  },
};

type VoiceRecognitionEvent = { results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }> };
type VoiceRecognitionErrorEvent = { error?: string };
type VoiceRecognition = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives?: number; start: () => void; stop: () => void; abort: () => void; onresult: ((event: VoiceRecognitionEvent) => void) | null; onerror: ((event: VoiceRecognitionErrorEvent) => void) | null; onend: (() => void) | null };
type VoiceRecognitionConstructor = new () => VoiceRecognition;

const voiceSteps = [
  { name: "eventDate", question: "Ist das heutige Datum richtig? Antworte mit ja oder nein." },
  { name: "apiary", question: "An welchem Bienenstand fand die Durchsicht statt?" },
  { name: "colonies", question: "Welches Volk oder welche Völker wurden durchgesehen?" },
  { name: "colonyCount", question: "Wie viele Völker wurden durchgesehen?" },
  { name: "hiveWeightKg", question: "Wie hoch ist das Beutengewicht in Kilogramm? Sage zum Beispiel zweiundvierzig Komma fünf oder überspringe die Angabe." },
  { name: "queenright", question: "Ist das Volk weiselrichtig? Antworte mit ja, unsicher oder nein." },
  { name: "brood", question: "Wie ist das Brutbild? Geschlossen, lückig, keine Brut oder nicht geprüft?" },
  { name: "stores", question: "Wie ist der Futtervorrat? Gut, knapp, kritisch oder nicht geprüft?" },
  { name: "varroaMethod", question: "Wie wurde Varroa kontrolliert? Zum Beispiel mit der Windel oder Puderzucker." },
  { name: "varroaCount", question: "Wie lautet die Milbenzahl oder das Ergebnis mit Zeitraum?" },
  { name: "diseaseSigns", question: "Gab es Krankheitsanzeichen? Keine, auffällig oder Verdacht?" },
  { name: "action", question: "Welche Maßnahme wurde veranlasst? Sage keine, falls nichts gemacht wurde." },
  { name: "notes", question: "Möchtest du eine Bemerkung ergänzen? Sage keine, falls nicht." },
] as const;

const spokenUnits: Record<string, number> = {
  null: 0, ein: 1, eins: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5,
  sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
  dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17,
  achtzehn: 18, neunzehn: 19,
};
const spokenTens: Record<string, number> = {
  zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60,
  siebzig: 70, achtzig: 80, neunzig: 90,
};

function parseSpokenGermanNumber(value: string) {
  const compact = value.toLocaleLowerCase("de-DE").replace(/[\s-]/g, "");
  if (/^\d+$/.test(compact)) return compact;
  if (spokenUnits[compact] !== undefined) return String(spokenUnits[compact]);
  if (spokenTens[compact] !== undefined) return String(spokenTens[compact]);
  const compound = compact.match(/^(ein|eins|eine|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig)$/);
  if (compound) return String(spokenUnits[compound[1]] + spokenTens[compound[2]]);
  return "";
}

function voiceComparable(value: string) {
  return value.toLocaleLowerCase("de-DE").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function parseSpokenGermanDate(value: string) {
  const answer = value.toLocaleLowerCase("de-DE").trim();
  const today = new Date();
  if (/^(heute|ja|richtig)$/.test(answer)) return today.toISOString().slice(0, 10);
  if (answer === "gestern") { today.setDate(today.getDate() - 1); return today.toISOString().slice(0, 10); }
  const numeric = answer.match(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : today.getFullYear();
    const date = new Date(year, Number(numeric[2]) - 1, Number(numeric[1]));
    if (date.getFullYear() === year && date.getMonth() === Number(numeric[2]) - 1 && date.getDate() === Number(numeric[1])) return `${year}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }
  const months: Record<string, number> = { januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
  const written = answer.match(/\b(\d{1,2})\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+(\d{4}))?\b/);
  if (written) return `${written[3] || today.getFullYear()}-${String(months[written[2]]).padStart(2, "0")}-${written[1].padStart(2, "0")}`;
  return "";
}

function normalizeVoiceChoice(name: string, spoken: string) {
  const answer = spoken.toLocaleLowerCase("de-DE").trim();
  if (name === "queenright") {
    if (answer.includes("unsicher")) return "Unsicher";
    if (answer.includes("nein") || answer.includes("nicht weisel")) return "Nein";
    if (answer.includes("ja") || answer.includes("weiselrichtig")) return "Ja";
  }
  if (name === "brood") {
    if (answer.includes("nicht geprüft") || answer.includes("nicht gepruft")) return "Nicht geprüft";
    if (answer.includes("keine brut")) return "Keine Brut";
    if (answer.includes("lückig") || answer.includes("luckig")) return "Lückig";
    if (answer.includes("geschlossen")) return "Geschlossen";
  }
  if (name === "stores") {
    if (answer.includes("nicht geprüft") || answer.includes("nicht gepruft")) return "Nicht geprüft";
    if (answer.includes("kritisch")) return "Kritisch";
    if (answer.includes("knapp")) return "Knapp";
    if (answer.includes("gut")) return "Gut";
  }
  if (name === "diseaseSigns") {
    if (answer.includes("verdacht")) return "Verdacht – Meldung prüfen";
    if (answer.includes("auffällig") || answer.includes("auffallig")) return "Auffällig";
    if (answer.includes("keine") || answer.includes("nein")) return "Keine";
  }
  if (name === "colonyCount") {
    return answer.match(/\d+/)?.[0] || parseSpokenGermanNumber(answer) || spoken;
  }
  if (name === "hiveWeightKg") {
    if (["überspringen", "überspringe", "keine angabe", "unbekannt"].includes(answer)) return "";
    const withoutUnit = answer.replace(/kilogramm|kilo|kg/g, "").trim();
    const parts = withoutUnit.split(/\s*(?:komma|,|punkt)\s*/);
    const whole = parts[0].match(/\d+/)?.[0] || parseSpokenGermanNumber(parts[0]);
    const decimal = parts[1] ? (parts[1].match(/\d+/)?.[0] || parseSpokenGermanNumber(parts[1])) : "";
    if (whole) return decimal ? `${whole}.${decimal}` : whole;
    return spoken;
  }
  if ((name === "action" || name === "notes") && ["keine", "nichts", "nein"].includes(answer)) return "";
  return spoken.trim();
}

function InspectionVoiceAssistant({ formRef }: { formRef: React.RefObject<HTMLFormElement | null> }) {
  const [step, setStep] = useState(0);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("Bereit für die sprachgeführte Durchsicht.");
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const browserWindow = typeof window === "undefined" ? null : window as typeof window & { SpeechRecognition?: VoiceRecognitionConstructor; webkitSpeechRecognition?: VoiceRecognitionConstructor };
  const supported = Boolean(browserWindow && (browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition) && "speechSynthesis" in window);

  useEffect(() => {
    return () => { recognitionRef.current?.abort(); window.speechSynthesis?.cancel(); };
  }, []);

  function ask(index: number) {
    const Recognition = browserWindow?.SpeechRecognition || browserWindow?.webkitSpeechRecognition;
    if (!Recognition || !formRef.current) return;
    const current = voiceSteps[index];
    if (!current) {
      setActive(false); setStatus("Fertig. Bitte Angaben prüfen und den Eintrag speichern.");
      const done = new SpeechSynthesisUtterance("Die Durchsicht ist vollständig erfasst. Bitte prüfe die Angaben und speichere den Eintrag."); done.lang = "de-DE"; window.speechSynthesis.speak(done); return;
    }
    setStep(index); setStatus("Frage wird vorgelesen …"); window.speechSynthesis.cancel(); recognitionRef.current?.abort();
    const utterance = new SpeechSynthesisUtterance(current.question); utterance.lang = "de-DE";
    utterance.onend = () => {
      setStatus("Ich höre zu …");
      const recognition = new Recognition(); recognition.lang = "de-DE"; recognition.interimResults = false; recognition.continuous = false;
      recognition.onresult = (event) => {
        const spoken = event.results[0]?.[0]?.transcript || "";
        const field = formRef.current?.elements.namedItem(current.name);
        if (current.name === "eventDate" && !spoken.toLocaleLowerCase("de-DE").includes("ja")) setStatus("Bitte das Datum von Hand ändern; danach geht es weiter.");
        else if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
          field.value = current.name === "eventDate" ? field.value : normalizeVoiceChoice(current.name, spoken);
          field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true })); setStatus(`Erkannt: „${spoken}“`);
        }
        const next = index + 1; setStep(next); window.setTimeout(() => ask(next), 900);
      };
      recognition.onerror = () => setStatus("Nicht verstanden. Tippe auf „Noch einmal fragen“.");
      recognition.onend = () => { recognitionRef.current = null; };
      recognitionRef.current = recognition; recognition.start();
    };
    window.speechSynthesis.speak(utterance);
  }

  function stop() { recognitionRef.current?.abort(); window.speechSynthesis.cancel(); setActive(false); setStatus("Sprachführung pausiert. Die eingetragenen Angaben bleiben erhalten."); }

  if (!supported) return <div className="voice-assistant unsupported"><b>Sprachführung in diesem Browser nicht verfügbar</b><span>Die Durchsicht kann weiterhin normal eingetippt werden. Am zuverlässigsten funktioniert Spracheingabe in Chrome oder Edge.</span></div>;
  return <div className={`voice-assistant ${active ? "active" : ""}`}>
    <div className="voice-head"><span aria-hidden="true">🎙️</span><div><b>Durchsicht im Gespräch erfassen</b><small>Die App fragt – du antwortest. Vor dem Speichern bleibt alles sichtbar und änderbar.</small></div></div>
    {active && <div className="voice-question"><small>Frage {Math.min(step + 1, voiceSteps.length)} von {voiceSteps.length}</small><strong>{voiceSteps[step]?.question || "Bitte Angaben prüfen."}</strong></div>}
    <p aria-live="polite">{status}</p><div className="voice-actions">
      {!active ? <button type="button" className="button primary" onClick={() => { setActive(true); ask(step >= voiceSteps.length ? 0 : step); }}>Sprachführung starten</button> : <button type="button" className="button ghost" onClick={() => ask(step)}>Noch einmal fragen</button>}
      {active && <button type="button" className="button ghost" onClick={stop}>Stoppen</button>}
    </div><small className="voice-privacy">Die Mikrofonfreigabe erteilt der Browser. Es wird keine Sprachaufnahme in der App gespeichert.</small>
  </div>;
}

function GlobalVoiceControl({ activeForm, openForm, goTo, onNotice }: {
  activeForm: RecordType | "chooser" | null;
  openForm: (type: RecordType | "chooser" | null) => void;
  goTo: (view: View) => void;
  onNotice: (message: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("Bereit");
  const [fieldIndex, setFieldIndex] = useState(0);
  const [lastHeard, setLastHeard] = useState("");
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const activeRef = useRef(false);
  const fieldIndexRef = useRef(0);
  const retryRef = useRef(0);
  const transcriptBufferRef = useRef("");
  const responseTimerRef = useRef<number | null>(null);
  const isListeningRef = useRef(false);
  const handlingRef = useRef(false);
  const speechSequenceRef = useRef(0);
  const spokenPromptRef = useRef("");
  const activeFormRef = useRef(activeForm);
  const handleRef = useRef<(answer: string) => void>(() => {});
  const restartTimerRef = useRef<number | null>(null);
  activeFormRef.current = activeForm;
  const browserWindow = typeof window === "undefined" ? null : window as typeof window & { SpeechRecognition?: VoiceRecognitionConstructor; webkitSpeechRecognition?: VoiceRecognitionConstructor };
  const supported = Boolean(browserWindow && (browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition) && "speechSynthesis" in window);

  const fields = () => Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(".entry-form input:not([type=file]),.entry-form select,.entry-form textarea"));
  const labelOf = (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => element.closest(".field")?.querySelector(":scope > span")?.textContent?.replace("*", "").trim() || element.closest(".confirmation-field")?.textContent?.replace("*", "").trim() || element.name || "nächstes Feld";
  const resetResponse = () => {
    transcriptBufferRef.current = "";
    if (responseTimerRef.current !== null) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = null;
  };
  const listen = () => {
    if (!activeRef.current || isListeningRef.current || handlingRef.current) return;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
    try {
      recognitionRef.current?.start();
      isListeningRef.current = true;
      setStatus("Mikrofon aktiv – ich höre sofort zu. Du kannst auch eine Ansage unterbrechen.");
    } catch {
      // Some engines still have an audio session closing. Retry after it releases the mic.
      restartTimerRef.current = window.setTimeout(listen, 550);
    }
  };
  const queueListen = (delay = 150) => {
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => { restartTimerRef.current = null; listen(); }, delay);
  };
  const speak = (text: string, thenListen = true, after?: () => void) => {
    speechSequenceRef.current += 1;
    const sequence = speechSequenceRef.current;
    window.speechSynthesis.cancel();
    spokenPromptRef.current = text;
    if (thenListen) resetResponse();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "de-DE"; utterance.rate = 1; utterance.pitch = 1;
    utterance.onend = () => {
      if (sequence !== speechSequenceRef.current || !activeRef.current) return;
      after?.();
      queueListen(80);
    };
    utterance.onerror = () => {
      if (sequence !== speechSequenceRef.current || !activeRef.current) return;
      after?.();
      queueListen(80);
    };
    setStatus(text);
    window.speechSynthesis.speak(utterance);
    // Listening stays enabled during prompts, so a user's answer may interrupt TTS.
    queueListen(80);
  };
  const isPromptEcho = (value: string) => {
    const heard = voiceComparable(value);
    const prompt = voiceComparable(spokenPromptRef.current);
    return heard.length >= 10 && (prompt.startsWith(heard) || (heard.length >= 22 && prompt.includes(heard)));
  };
  const promptFor = (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
    const label = labelOf(element);
    if (element instanceof HTMLSelectElement) {
      const choices = Array.from(element.options).filter((option) => option.value).map((option) => option.textContent).filter(Boolean);
      return `${label}. Wähle ${choices.join(", ")} oder sage überspringen.`;
    }
    if (element instanceof HTMLInputElement && element.type === "date") return `${label}. Sage heute, gestern oder ein Datum, zum Beispiel 14. September.`;
    if (element instanceof HTMLInputElement && element.type === "checkbox") return `${label}. Antworte mit ja oder nein.`;
    if (element instanceof HTMLTextAreaElement || ["notes", "action", "description"].includes(element.name)) return `${label}. Sprich frei und auch gerne mehrere Sätze. Ich übernehme alles nach einer längeren Sprechpause.`;
    return `${label}. Bitte antworte oder sage überspringen.`;
  };
  const askField = (index: number) => {
    window.setTimeout(() => {
      if (!activeRef.current) return;
      const formFields = fields();
      if (!formFields.length) return speak("Das Formular wird geöffnet. Einen Moment bitte.");
      const next = Math.max(0, Math.min(index, formFields.length - 1));
      fieldIndexRef.current = next; setFieldIndex(next);
      formFields[next].scrollIntoView({ behavior: "smooth", block: "center" });
      speak(promptFor(formFields[next]));
    }, 180);
  };
  const setFieldValue = (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, spoken: string) => {
    let value = spoken.trim();
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      element.checked = /ja|bestätigt|geprüft|richtig/i.test(value) && !/nein|nicht/i.test(value);
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: element.checked ? "Ja" : "Nein", message: "" };
    } else if (element instanceof HTMLSelectElement) {
      const normalized = voiceComparable(value);
      const option = Array.from(element.options).find((item) => item.value && (normalized.includes(voiceComparable(item.value)) || voiceComparable(item.value).includes(normalized)));
      if (!option) return { ok: false, value: "", message: `Die Antwort passt zu keiner Auswahl bei ${labelOf(element)}.` };
      value = option.value;
    } else if (element.type === "number") value = normalizeVoiceChoice(element.name, spoken);
    else if (element.type === "date") {
      value = parseSpokenGermanDate(spoken);
      if (!value) return { ok: false, value: "", message: "Das Datum habe ich nicht erkannt." };
    }
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter?.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: element instanceof HTMLInputElement && element.type === "checkbox" ? (element.checked ? "Ja" : "Nein") : value, message: "" };
  };
  const chooseAction = (spoken: string) => {
    const command = spoken.toLocaleLowerCase("de");
    const actions: Array<[string[], RecordType]> = [
      [["durchsicht", "kontrolle"], "inspection"], [["behandlung", "arzneimittel"], "treatment"], [["fütterung", "futter"], "feeding"], [["honigernte", "ernte"], "harvest"], [["hygiene", "reinigung"], "hygiene"], [["krankheit", "verdacht", "seuche"], "disease"], [["bienenstand", "stand anlegen"], "apiary"], [["bienenvolk", "volk anlegen"], "colony"], [["zuchtserie"], "queenSeries"], [["königin"], "queen"], [["notiz", "bemerkung"], "note"],
    ];
    const match = actions.find(([words]) => words.some((word) => command.includes(word)));
    if (match) { activeFormRef.current = match[1]; openForm(match[1]); fieldIndexRef.current = 0; setFieldIndex(0); window.setTimeout(() => askField(0), 500); return true; }
    const views: Array<[string[], View]> = [[["übersicht", "startseite"], "dashboard"], [["einträge", "chronik"], "records"], [["stände", "völker"], "apiaries"], [["königinnenzucht", "zuchtbereich"], "breeding"], [["export", "sicherung"], "export"], [["pflichten", "recht"], "legal"], [["hilfe", "handbuch"], "help"]];
    const view = views.find(([words]) => words.some((word) => command.includes(word)));
    if (view) { goTo(view[1]); speak(`${view[0][0]} ist geöffnet. Was möchtest du als Nächstes tun?`); return true; }
    return false;
  };
  const handle = (spoken: string) => {
    const command = spoken.toLocaleLowerCase("de").trim();
    retryRef.current = 0; setLastHeard(spoken.trim());
    if (/sprachmodus (beenden|stoppen)|^stopp$/.test(command)) return stop();
    if (command.includes("frage wiederholen") || command === "wiederholen") return activeFormRef.current && activeFormRef.current !== "chooser" ? askField(fieldIndexRef.current) : speak("Was möchtest du tun? Zum Beispiel Durchsicht, Behandlung, Notiz oder Königinnenzucht.");
    if (command.includes("durchsicht neu") || command.includes("formular neu") || command === "neu starten") { fieldIndexRef.current = 0; setFieldIndex(0); return askField(0); }
    if (command.includes("abbrechen") || command.includes("formular schließen")) { activeFormRef.current = null; openForm(null); return speak("Formular geschlossen. Was möchtest du tun?"); }
    if (command === "speichern" || command.includes("eintrag speichern")) { const form = document.querySelector<HTMLFormElement>(".entry-form"); if (form) { form.requestSubmit(); speak("Der Eintrag wird gespeichert.", false); } else speak("Es ist kein Formular geöffnet."); return; }
    if (!activeFormRef.current || activeFormRef.current === "chooser") { if (!chooseAction(command)) speak("Das habe ich nicht zugeordnet. Sage zum Beispiel Durchsicht, Behandlung, Fütterung, Notiz oder Königinnenzucht."); return; }
    const formFields = fields();
    if (!formFields.length) return speak("Ich finde noch kein geöffnetes Formular.");
    const targetByName = formFields.findIndex((field) => command.includes(labelOf(field).toLocaleLowerCase("de")));
    if ((command.startsWith("zurück zu") || command.startsWith("gehe zu")) && targetByName >= 0) return askField(targetByName);
    if (command === "zurück" || command.includes("vorherige frage") || command === "korrigieren" || command.includes("letzte antwort korrigieren")) return askField(fieldIndexRef.current - 1);
    if (command === "weiter" || command === "überspringen") {
      const current = formFields[fieldIndexRef.current];
      if (current.required) return speak(`${labelOf(current)} ist ein Pflichtfeld und kann nicht übersprungen werden. ${promptFor(current)}`);
      return fieldIndexRef.current >= formFields.length - 1 ? speak("Das Formular ist vollständig. Sage speichern oder gehe mit einem Feldnamen zurück.") : askField(fieldIndexRef.current + 1);
    }
    if (command.startsWith("notiz hinzufügen")) {
      const note = formFields.find((field) => field.name === "notes");
      if (note) { const content = spoken.replace(/notiz hinzufügen/i, "").trim(); setFieldValue(note, `${note.value ? `${note.value}\n` : ""}${content}`); return speak("Notiz ergänzt. Ich fahre mit der aktuellen Frage fort."); }
    }
    const current = formFields[fieldIndexRef.current];
    const result = setFieldValue(current, spoken);
    if (!result?.ok) return speak(`${result?.message || "Das habe ich nicht erkannt"} ${promptFor(current)}`);
    if (fieldIndexRef.current >= formFields.length - 1) speak(`Eingetragen: ${result.value || "Nein"}. Alle Fragen sind durchlaufen. Sage speichern, korrigieren oder den Namen eines Feldes.`);
    else speak(`Eingetragen: ${result.value || "Nein"}.`, false, () => askField(fieldIndexRef.current + 1));
  };
  handleRef.current = handle;
  function start() {
    if (!supported || !browserWindow) return onNotice("Sprachsteuerung wird in diesem Browser nicht unterstützt. Bitte Chrome oder Edge verwenden.");
    const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "de-DE";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 3;
    const finishAnswer = () => {
      if (!activeRef.current || handlingRef.current) return;
      const answer = transcriptBufferRef.current.trim();
      if (!answer) { resetResponse(); queueListen(); return; }
      handlingRef.current = true;
      if (responseTimerRef.current !== null) window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
      try { recognition.abort(); } catch {}
      const cleaned = answer;
      resetResponse();
      setLastHeard(cleaned);
      try { handleRef.current(cleaned); }
      finally {
        handlingRef.current = false;
        queueListen(220);
      }
    };
    recognition.onresult = (event) => {
      if (!activeRef.current || handlingRef.current) return;
      // Web Speech sends the full result list again on every update. Never append it.
      const raw = Array.from(event.results).map((item) => item[0]?.transcript || "").join(" ").replace(/\s+/g, " ").trim();
      if (!raw || isPromptEcho(raw)) return;
      const finishNow = /(?:^|\s)(?:antwort\s+)?fertig[.!?]?$/i.test(raw);
      const cleaned = raw.replace(/(?:^|\s)(?:antwort\s+)?fertig[.!?]?$/i, "").trim();
      if (!cleaned && !finishNow) return;
      if (window.speechSynthesis.speaking) {
        speechSequenceRef.current += 1;
        window.speechSynthesis.cancel();
      }
      transcriptBufferRef.current = cleaned;
      setLastHeard(cleaned || raw);
      setStatus(finishNow ? "Antwort wird übernommen …" : "Ich höre zu …");
      if (responseTimerRef.current !== null) window.clearTimeout(responseTimerRef.current);
      // Short fields react quickly. Longer notes allow more time for a natural pause.
      const current = fields()[fieldIndexRef.current];
      const freeText = current instanceof HTMLTextAreaElement || ["notes", "action", "description"].includes(current?.name || "");
      responseTimerRef.current = window.setTimeout(finishAnswer, finishNow ? 80 : freeText ? 2400 : 1100);
    };
    recognition.onerror = (event) => {
      if (!activeRef.current || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        stop();
        onNotice("Mikrofon nicht verfügbar. Bitte die Mikrofonberechtigung und das Eingabegerät prüfen.");
        return;
      }
      // Silence or a temporary network interruption is not an answer. Reopen the mic.
      setStatus("Ich höre weiter zu – bitte sprich noch einmal.");
    };
    recognition.onend = () => {
      isListeningRef.current = false;
      if (!activeRef.current || handlingRef.current) return;
      if (transcriptBufferRef.current && responseTimerRef.current === null) finishAnswer();
      else queueListen(200);
    };
    recognitionRef.current = recognition;
    activeRef.current = true;
    setActive(true);
    resetResponse();
    listen(); // Start the microphone immediately, before speech synthesis begins.
    if (activeFormRef.current && activeFormRef.current !== "chooser") askField(fieldIndexRef.current);
    else speak("Was möchtest du tun? Zum Beispiel Durchsicht, Behandlung, Fütterung oder Notiz.");
  }
  function stop() {
    activeRef.current = false;
    setActive(false);
    resetResponse();
    speechSequenceRef.current += 1;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
    try { recognitionRef.current?.abort(); } catch {}
    isListeningRef.current = false;
    window.speechSynthesis?.cancel();
    setStatus("Sprachmodus beendet");
  }
  useEffect(() => () => {
    activeRef.current = false;
    if (responseTimerRef.current !== null) window.clearTimeout(responseTimerRef.current);
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);
  const totalFields = activeForm && activeForm !== "chooser" ? fields().length : 0;
  return <aside className={`global-voice ${active ? "active" : ""}`} aria-live="polite"><button className="global-voice-main" onClick={active ? stop : start}><span>{active ? "■" : "🎙"}</span><b>{active ? "Sprachmodus stoppen" : "Sprachmodus starten"}</b></button>{active && <div className="global-voice-status"><span className="voice-pulse"/><div className="voice-status-copy"><b>{status}</b>{lastHeard && <span>Erkannt: „{lastHeard}“</span>}<small>{totalFields ? `Frage ${Math.min(fieldIndex + 1, totalFields)} von ${totalFields}` : "Menüauswahl"} · Du kannst die Ansage unterbrechen und direkt sprechen</small><small>Sage „fertig“ für sofortige Übernahme; kurze Antworten brauchen etwa 1 Sekunde Pause, längere Notizen 2,4 Sekunden.</small><small>Befehle: wiederholen, zurück, korrigieren, überspringen, neu starten, speichern</small>{totalFields > 0 && <i className="voice-progress" aria-hidden="true"><i style={{ width: `${Math.max(4, ((fieldIndex + 1) / totalFields) * 100)}%` }} /></i>}</div></div>}</aside>;
}

function GenericForm({ type, onSaved, onCancel }: { type: Exclude<RecordType, "treatment">; onSaved: (record: BeeRecord, notice?: string) => void; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const config = formConfigs[type];
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const files = takeFiles(form);
    const payload = formPayload(form);
    try {
      if (!validDate(payload.eventDate)) throw new Error("Das Datum ist ungültig.");
      const now = new Date().toISOString();
      const record: BeeRecord = {
        id: crypto.randomUUID(),
        type,
        eventDate: payload.eventDate,
        title: `${labels[type].label} · ${payload[config.titleField] || "Eintrag"}`,
        payload,
        createdAt: now,
        updatedAt: now,
      };
      await putRecord(record);
      try {
        await addAttachments(record.id, files);
        onSaved(record, files.length ? `${files.length} Datei${files.length === 1 ? "" : "en"} lokal zum Eintrag gespeichert.` : undefined);
      } catch (uploadError) {
        onSaved(record, `Eintrag lokal gespeichert, aber der Beleg konnte nicht gespeichert werden: ${uploadError instanceof Error ? uploadError.message : "unbekannter Fehler"}`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} className="entry-form" onSubmit={submit}>
      <div className="form-heading">
        <div><span className="eyebrow">{config.kicker}</span><h2>{labels[type].label}</h2></div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="Formular schließen">×</button>
      </div>
      <p className="form-note">{config.note}</p>
      <div className="form-grid">
        {config.fields.map((field) => (
          <div className={field.wide ? "wide-field" : ""} key={field.name}>
            <Field label={field.label} name={field.name} required={field.required} type={field.type} placeholder={field.placeholder}>
              {field.options ? (
                <select name={field.name} required={field.required} defaultValue=""><option value="" disabled>Bitte wählen</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
              ) : field.name === "notes" || field.wide ? (
                <textarea name={field.name} required={field.required} rows={3} placeholder={field.placeholder} />
              ) : (
                <input name={field.name} type={field.type || "text"} required={field.required} min={field.min} placeholder={field.placeholder} defaultValue={field.type === "date" ? new Date().toISOString().slice(0, 10) : undefined} step={field.type === "number" ? field.step || "any" : undefined} />
              )}
            </Field>
          </div>
        ))}
      </div>
      <UploadField />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button ghost" type="button" onClick={onCancel}>Abbrechen</button><button className="button primary" disabled={saving}>{saving ? "Speichert …" : "Eintrag speichern"}</button></div>
    </form>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileThumbnail({ blob, contentType, fileName }: { blob: Blob; contentType: string; fileName: string }) {
  const isImage = contentType.startsWith("image/");
  const isPdf = contentType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const extension = fileName.split(".").pop()?.toUpperCase().slice(0, 5) || "DATEI";
  const url = useMemo(() => isImage || isPdf ? URL.createObjectURL(blob) : "", [blob, isImage, isPdf]);

  useEffect(() => {
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [url]);

  // eslint-disable-next-line @next/next/no-img-element -- lokale Blob-Vorschau ohne Server- oder Bildoptimierung
  if (isImage && url) return <span className="file-thumbnail"><img src={url} alt={`Vorschau von ${fileName}`} /></span>;
  if (isPdf && url) return <span className="file-thumbnail pdf-thumbnail"><iframe src={`${url}#page=1&toolbar=0&navpanes=0&scrollbar=0`} title={`PDF-Vorschau von ${fileName}`} tabIndex={-1} /><i>PDF</i></span>;
  return <span className="file-thumbnail document-thumbnail"><i>{extension}</i></span>;
}

function StoredFileThumbnail({ item }: { item: Attachment }) {
  const [blob, setBlob] = useState<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAttachment(item.id).then((stored) => { if (!cancelled && stored) setBlob(stored.blob); });
    return () => { cancelled = true; };
  }, [item.id]);

  return blob ? <FileThumbnail blob={blob} contentType={item.contentType} fileName={item.fileName} /> : <span className="file-thumbnail document-thumbnail"><i>…</i></span>;
}

function downloadContent(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AttachmentPanel({ recordId, onNotice, onDataChanged }: { recordId: string; onNotice: (message: string) => void; onDataChanged: () => void }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setItems(await listAttachments(recordId));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Dateien konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void listAttachments(recordId)
      .then((attachments) => { if (!cancelled) setItems(attachments); })
      .catch((error: Error) => { if (!cancelled) onNotice(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recordId, onNotice]);

  async function add(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      await addAttachments(recordId, files);
      await load();
      onDataChanged();
      onNotice(`${files.length} Datei${files.length === 1 ? "" : "en"} nur auf diesem Gerät gespeichert.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(item: Attachment) {
    if (!window.confirm(`„${item.fileName}“ wirklich löschen?`)) return;
    try {
      await deleteAttachment(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      onDataChanged();
      onNotice("Datei wurde gelöscht.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Datei konnte nicht gelöscht werden.");
    }
  }

  async function downloadLocal(item: Attachment) {
    try {
      const stored = await getAttachment(item.id);
      if (!stored) throw new Error("Datei nicht gefunden.");
      const url = URL.createObjectURL(stored.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Datei konnte nicht geöffnet werden.");
    }
  }

  return (
    <section className="attachments-panel">
      <div className="attachments-head"><div><span className="eyebrow">Dokumente</span><h3>Belege & Nachweise</h3></div><label className={`button secondary compact ${uploading ? "disabled" : ""}`}>＋ Datei<input type="file" multiple disabled={uploading} accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.txt,.csv,.xml,.doc,.docx,.xls,.xlsx" onChange={(event) => { void add(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} /></label></div>
      {loading ? <p className="attachment-empty">Dateien werden geladen …</p> : items.length ? <div className="attachment-list">{items.map((item) => <div key={item.id}><StoredFileThumbnail item={item} /><span><b>{item.fileName}</b><small>{formatBytes(item.size)} · {new Date(item.createdAt).toLocaleDateString("de-DE")}</small></span><button className="download-file" onClick={() => void downloadLocal(item)}>Herunterladen</button><button onClick={() => void remove(item)} aria-label={`${item.fileName} löschen`}>×</button></div>)}</div> : <p className="attachment-empty">Noch kein Beleg hinterlegt.</p>}
      <small className="attachment-hint">Belege bleiben als Browserdaten auf diesem Gerät. Eine vollständige Sicherung im Bereich Export schützt vor Datenverlust.</small>
    </section>
  );
}

const primaryTypes: RecordType[] = ["treatment", "inspection", "harvest", "feeding", "hygiene", "disease", "queenSeries", "queen", "note"];
const fieldNames: Record<string, string> = {
  firstDate: "Datum der ersten Verabreichung / Einlegen", endDate: "Tatsächliches Behandlungsende / Entnahme", eventDate: "Datum", product: "Tierarzneimittel",
  indication: "Grund / Indikation", dosageForm: "Darreichungsform", applicationMethod: "Anwendungsart", amount: "Menge", unit: "Einheit", amountBasis: "Mengenbezug", applicationCount: "Anzahl Anwendungen / Einsätze", applicationDates: "Wechsel-/Wiederholungsdaten", applicationDevice: "Applikationshilfe / Gerät", courseStatus: "Status am Behandlungsende", medicineBatch: "Charge des Präparats", colonies: "Volk / Völker", colonyCount: "Anzahl Völker", hiveWeightKg: "Beutengewicht (kg)",
  supplier: "Lieferant", supplierAddress: "Anschrift Lieferant", proof: "Erwerbsbeleg", withdrawalDays: "Wartezeit für Honig (Tage)", honeyRestriction: "Vorgabe zu Tracht / Honigräumen", leafletConfirmed: "Zulassung und Packungsbeilage geprüft",
  veterinarian: "Tierarzt", appliedBy: "Anwender", apiary: "Bienenstand", queenright: "Weiselrichtig", brood: "Brutbild",
  stores: "Futtervorrat", varroaMethod: "Varroa-Kontrolle", varroaCount: "Kontrollergebnis", diseaseSigns: "Krankheitsanzeichen",
  action: "Maßnahme", lot: "Los / Charge", honeyType: "Honig / Tracht", amountKg: "Menge (kg)", waterPercent: "Wassergehalt (%)",
  containers: "Gebinde", storageLocation: "Lagerort", recipient: "Abnehmer", feedName: "Futtermittel", feedOrigin: "Herkunft",
  batch: "Charge / Beleg", ratio: "Mischungsverhältnis", area: "Bereich / Gerät", measure: "Maßnahme", agent: "Reinigungsmittel",
  result: "Ergebnis", performedBy: "Durchgeführt von", disease: "Seuche / Verdacht", reason: "Nachweis / Verdachtsgründe",
  location: "Standort", otherColonies: "Weitere empfängliche Völker", housing: "Haltungsform", authority: "Zuständige Behörde",
  reporter: "Meldende Person", lab: "Untersuchungsstelle", testMethod: "Diagnose / Ergebnis", name: "Name", coordinates: "Koordinaten",
  registrationNumber: "Registriernummer", hiveSystem: "Beutensystem", colonyId: "Volksnummer", origin: "Herkunft",
  queenYear: "Königin Jahrgang", status: "Status", notes: "Bemerkung", activeIngredient: "Wirkstoff",
  productAvailability: "Bezugsquelle", productColonyState: "Zugelassen für", productListSource: "Präparateliste",
  seriesName: "Zuchtserie", breedingMethod: "Zuchtmethode", breedingMaterial: "Zuchtstoff", motherQueen: "Muttervolk / Zuchtbuchnummer", lineage: "Herkunft / Rasse / Linie", graftedCount: "Umgelarvte Larven", careColony: "Pflegevolk", careMethod: "Pflegeweise", acceptedCount: "Angenommene Zellen", incubator: "Wärmeschrank", hatchedCount: "Geschlüpfte Königinnen",
  queenId: "Königinnen-Nummer", matingUnit: "Begattungseinheit", matingType: "Begattungsart", matingLocation: "Stand / Belegstelle", introducedDate: "Eingesetzt am", matingStatus: "Begattungsstatus", layingSince: "In Eiablage seit", marked: "Gezeichnet", markedDate: "Gezeichnet am", wingClipped: "Flügel geschnitten", queenStatus: "Aktueller Status",
  noteTitle: "Titel der Notiz",
  voided: "Status", voidReason: "Stornogrund", voidedAt: "Storniert am",
};

function FullPrintReport({ records, attachments, catalog, catalogDate, reportPeriod }: {
  records: BeeRecord[];
  attachments: Record<string, Array<Attachment & { dataUrl: string }>>;
  catalog: ComplianceCatalog;
  catalogDate: string;
  reportPeriod: string;
}) {
  return (
    <section className="print-report">
      <header className="print-cover">
        <div className="print-brand"><span>BD</span><div><b>Bienen Doku</b><small>Imkerei-Dokumentation · Deutschland</small></div></div>
        <div className="print-title"><p>Vollständige Betriebsdokumentation</p><h1>Nachweise, Völker und Betriebschronik</h1><span>Zeitraum: {reportPeriod}</span></div>
        <dl><div><dt>Erstellt am</dt><dd>{new Date().toLocaleString("de-DE")}</dd></div><div><dt>Anzahl Einträge</dt><dd>{records.length}</dd></div><div><dt>Prüfkatalog</dt><dd>{catalog.version} · verifiziert {catalogDate}</dd></div><div><dt>Ersteller der App</dt><dd>T. Kruska</dd></div></dl>
        <p className="print-note">Diese Ausgabe dokumentiert den lokalen Datenbestand zum Erstellungszeitpunkt. Bildbelege und PDF-Dokumente werden nach Möglichkeit direkt bei ihrem Eintrag dargestellt. Sämtliche Originaldateien bleiben zusätzlich Bestandteil der Vollsicherung.</p>
      </header>
      <div className="print-summary"><h2>Inhaltsübersicht</h2><div>{(Object.keys(labels) as RecordType[]).map((type) => <span key={type}><b>{records.filter((record) => record.type === type).length}</b>{labels[type].label}</span>)}</div></div>
      <div className="print-records">
        {records.length ? records.map((record, index) => (
          <article className="print-record" key={record.id}>
            <header><span>{String(index + 1).padStart(3, "0")}</span><div><small>{labels[record.type].label} · {formatDate(record.eventDate)}{record.payload.voided ? " · STORNIERT" : ""}</small><h2>{record.title}</h2></div></header>
            <dl>{Object.entries(record.payload).filter(([, value]) => value !== "" && value !== null && value !== undefined).map(([key, value]) => <div key={key}><dt>{fieldNames[key] || key}</dt><dd>{key === "voided" ? (value ? "Storniert" : "Aktiv") : String(value)}</dd></div>)}</dl>
            <div className="print-files"><b>Belege und Nachweise</b>{attachments[record.id]?.length ? <div className="print-file-previews">{attachments[record.id].map((item) => <figure key={item.id}>{item.contentType.startsWith("image/") ? <img src={item.dataUrl} alt={`Beleg ${item.fileName}`} /> : item.contentType === "application/pdf" ? <object className="print-file-pdf" data={item.dataUrl} type="application/pdf"><span>PDF-Beleg vollständig in der sichtbaren HTML-Sicherung enthalten.</span></object> : <span className="print-document-placeholder">Dokument vollständig in der sichtbaren HTML-Sicherung enthalten.</span>}<figcaption>{item.fileName} · {formatBytes(item.size)}</figcaption></figure>)}</div> : <span>Keine Belegdatei hinterlegt.</span>}</div>
            <footer><span>Datensatz-ID: {record.id}</span><span>Erfasst: {new Date(record.createdAt).toLocaleString("de-DE")}</span></footer>
          </article>
        )) : <p className="print-empty">Zum Erstellungszeitpunkt waren noch keine Einträge gespeichert.</p>}
      </div>
      <section className="print-closing"><h2>Hinweise zur Aufbewahrung</h2><p>Arzneimittel-Aufzeichnungen müssen mindestens fünf Jahre zur Kontrolle verfügbar bleiben. Maßgeblich sind der aktuelle amtliche Wortlaut, Zulassungsstatus, Packungsbeilage und behördliche Vorgaben. Diese App ist eine Dokumentationshilfe und keine Rechtsberatung.</p><div className="signature-lines"><span>Ort, Datum</span><span>Unterschrift</span></div><small>Erstellt mit Bienen Doku · Open Source · T. Kruska</small></section>
    </section>
  );
}

export default function BeeApp({ displayName }: { displayName: string }) {
  const [records, setRecords] = useState<BeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [activeForm, setActiveForm] = useState<RecordType | "chooser" | null>(null);
  const [selected, setSelected] = useState<BeeRecord | null>(null);
  const [filter, setFilter] = useState<RecordType | "all">("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(true);
  const [catalog, setCatalog] = useState<ComplianceCatalog>(DEFAULT_COMPLIANCE_CATALOG);
  const [catalogStatus, setCatalogStatus] = useState<"idle" | "checking" | "current" | "updated" | "offline" | "error">("idle");
  const [lastOnlineCatalogCheck, setLastOnlineCatalogCheck] = useState<string | null>(null);
  const [sourceCheck, setSourceCheck] = useState<SourceCheck | null>(null);
  const [currentTime] = useState(() => Date.now());
  const [syncCode, setSyncCode] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("off");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [persistentStorage, setPersistentStorage] = useState<boolean | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const [autoBackupSettings, setAutoBackupSettings] = useState<AutoBackupSettings>({ mode: null, fileName: null, lastBackupAt: null });
  const [autoBackupHandle, setAutoBackupHandle] = useState<WritableBackupHandle | null>(null);
  const [autoBackupStatus, setAutoBackupStatus] = useState<AutoBackupStatus>("off");
  const [filePickerSupported, setFilePickerSupported] = useState(false);
  const [printReport, setPrintReport] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [printAttachments, setPrintAttachments] = useState<Record<string, Array<Attachment & { dataUrl: string }>>>({});
  const [quickstartOpen, setQuickstartOpen] = useState(false);
  const [weatherLocation, setWeatherLocation] = useState<{ postalCode: string; latitude: number; longitude: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(window.localStorage.getItem("bienendoku-weather-location-v1") || "null"); } catch { return null; }
  });
  const [postalCodeInput, setPostalCodeInput] = useState(() => weatherLocation?.postalCode || "");
  const [grassTemperature, setGrassTemperature] = useState<{ postalCode: string; value: number; calculatedThrough: string; updatedAt: string } | null>(() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(window.localStorage.getItem("bienendoku-gts-v2") || "null"); } catch { return null; }
  });
  const restoreInput = useRef<HTMLInputElement>(null);
  const markDataChanged = useCallback(() => setDataRevision((current) => current + 1), []);
  const syncRunning = useRef(false);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function saveWeatherPostalCode() {
    const postalCode = postalCodeInput.trim();
    if (!/^\d{5}$/.test(postalCode)) return setNotice("Bitte eine gültige fünfstellige deutsche PLZ eingeben.");
    try {
      const response = await fetch(`https://api.zippopotam.us/de/${postalCode}`);
      if (!response.ok) throw new Error("PLZ wurde nicht gefunden.");
      const data = await response.json() as { places?: Array<{ latitude: string; longitude: string }> };
      const places = data.places || [];
      if (!places.length) throw new Error("Für diese PLZ wurden keine Koordinaten gefunden.");
      const latitude = places.reduce((sum, place) => sum + Number(place.latitude), 0) / places.length;
      const longitude = places.reduce((sum, place) => sum + Number(place.longitude), 0) / places.length;
      const location = { postalCode, latitude, longitude };
      window.localStorage.setItem("bienendoku-weather-location-v1", JSON.stringify(location));
      setWeatherLocation(location);
      setGrassTemperature(null);
      setNotice(`Wetterregion ${postalCode} wurde gespeichert. Die Grünlandtemperatursumme wird aktualisiert.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "PLZ konnte nicht geprüft werden.");
    }
  }

  const runDeviceSync = useCallback(async (code: string, interactive = false) => {
    if (!navigator.onLine) {
      setSyncStatus("offline");
      if (interactive) setNotice("Offline: Der automatische Abgleich startet bei der nächsten Internetverbindung.");
      return;
    }
    if (syncRunning.current) return;
    syncRunning.current = true;
    setSyncStatus("syncing");
    try {
      const normalized = normalizeSyncCode(code);
      const id = await syncEndpointId(normalized);
      const remote = await fetch(`/api/sync/${id}`, { cache: "no-store" });
      if (remote.ok) {
        const encrypted = await remote.json() as EncryptedSyncPayload;
        await restoreBackup(await decryptBackup(normalized, encrypted));
        setRecords(await listRecords());
      } else if (remote.status !== 404) {
        throw new Error("Der Sync-Speicher ist momentan nicht erreichbar.");
      }
      const { payload } = await encryptBackup(normalized, await createBackup());
      const saved = await fetch(`/api/sync/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!saved.ok) throw new Error("Die verschlüsselten Daten konnten nicht synchronisiert werden.");
      const completedAt = new Date().toISOString();
      setLastSyncedAt(completedAt);
      setSyncStatus("synced");
      if (interactive) setNotice("Smartphone und PC wurden automatisch abgeglichen.");
    } catch (error) {
      setSyncStatus("error");
      if (interactive) setNotice(error instanceof Error ? error.message : "Synchronisierung fehlgeschlagen.");
    } finally {
      syncRunning.current = false;
    }
  }, []);

  function startNewSync() {
    const code = createSyncCode();
    window.localStorage.setItem("bienendoku-sync-code-v1", code);
    setSyncCode(code);
    setSyncStatus("ready");
    void runDeviceSync(code, true);
  }

  function connectExistingSync() {
    const entered = window.prompt("Persönlichen Bienen Doku-Sync-Code vom anderen Gerät eingeben:");
    if (!entered) return;
    try {
      const code = normalizeSyncCode(entered);
      window.localStorage.setItem("bienendoku-sync-code-v1", code);
      setSyncCode(code);
      setSyncStatus("ready");
      void runDeviceSync(code, true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sync-Code ist ungültig.");
    }
  }

  function disableDeviceSync() {
    if (!window.confirm("Automatische Synchronisierung auf diesem Gerät ausschalten? Die lokalen Daten bleiben erhalten.")) return;
    window.localStorage.removeItem("bienendoku-sync-code-v1");
    setSyncCode("");
    setSyncStatus("off");
    setLastSyncedAt(null);
  }

  const writeAutoBackup = useCallback(async (mode: Exclude<AutoBackupMode, null>, handle: WritableBackupHandle | null, interactive: boolean) => {
    setAutoBackupStatus("saving");
    try {
      const backup = await createBackup();
      let fileName: string;
      if (mode === "file") {
        if (!handle) throw new Error("Die Auto-Backup-Datei muss erneut verbunden werden.");
        let permission: PermissionState = handle.queryPermission ? await handle.queryPermission({ mode: "readwrite" }) : "granted";
        if (permission !== "granted" && interactive && handle.requestPermission) {
          permission = await handle.requestPermission({ mode: "readwrite" });
        }
        if (permission !== "granted") {
          setAutoBackupStatus("permission");
          if (interactive) setNotice("Bitte die Schreibberechtigung für die Auto-Backup-Datei bestätigen.");
          return false;
        }
        const writable = await handle.createWritable();
        await writable.write(new Blob([JSON.stringify(backup)], { type: "application/json" }));
        await writable.close();
        fileName = handle.name;
      } else {
        const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
        fileName = `Bienen-Doku-AutoBackup-${stamp}.json`;
        downloadContent(fileName, "application/json", JSON.stringify(backup));
      }
      const nextSettings: AutoBackupSettings = { mode, fileName, lastBackupAt: new Date().toISOString() };
      await putMeta("autoBackupSettings", nextSettings);
      setAutoBackupSettings(nextSettings);
      setAutoBackupStatus("saved");
      if (interactive) setNotice(`Auto-Sicherung erstellt: ${fileName}`);
      return true;
    } catch (error) {
      setAutoBackupStatus(error instanceof DOMException && error.name === "NotAllowedError" ? "permission" : "error");
      if (interactive) setNotice(error instanceof Error ? error.message : "Auto-Sicherung fehlgeschlagen.");
      return false;
    }
  }, []);

  const refreshCatalog = useCallback(async (manual = false) => {
    if (!navigator.onLine) {
      setCatalogStatus("offline");
      if (manual) setNotice("Offline: Der zuletzt gespeicherte Prüfkatalog bleibt verfügbar.");
      return;
    }
    setCatalogStatus("checking");
    try {
      const response = await fetch("/data/compliance-catalog.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Prüfkatalog konnte nicht geladen werden.");
      const next = await response.json() as ComplianceCatalog;
      if (next.jurisdiction !== "DE" || !next.version || !next.verifiedAt || !next.nextReviewDue || !Number.isInteger(next.reviewIntervalDays) || !Array.isArray(next.products) || next.products.length < 1 || !Array.isArray(next.methods)) {
        throw new Error("Der geladene Prüfkatalog ist ungültig.");
      }
      const changed = next.version !== catalog.version;
      await putMeta("complianceCatalog", next);
      setCatalog(next);
      const checkedAt = new Date().toISOString();
      setLastOnlineCatalogCheck(checkedAt);
      try {
        const sourceResponse = await fetch("/api/compliance-check", { cache: "no-store" });
        if (sourceResponse.ok) setSourceCheck(await sourceResponse.json() as SourceCheck);
      } catch {
        setSourceCheck(null);
      }
      setCatalogStatus(changed ? "updated" : "current");
      if (manual) setNotice(changed ? `Prüfkatalog ${next.version} wurde aktualisiert.` : `Prüfkatalog ${next.version} ist aktuell.`);
    } catch (error) {
      setCatalogStatus("error");
      if (manual) setNotice(error instanceof Error ? error.message : "Katalogabgleich fehlgeschlagen.");
    }
  }, [catalog.version]);

  useEffect(() => {
    const quickstartTimer = window.setTimeout(() => {
      setQuickstartOpen(window.localStorage.getItem("bienendoku-quickstart-dismissed-v1") !== "yes");
    }, 0);
    const storedSyncCode = window.localStorage.getItem("bienendoku-sync-code-v1");
    if (storedSyncCode) {
      window.setTimeout(() => {
        setSyncCode(storedSyncCode);
        setSyncStatus(navigator.onLine ? "ready" : "offline");
      }, 0);
    }
    listRecords()
      .then(setRecords)
      .catch((error: Error) => setNotice(error.message))
      .finally(() => setLoading(false));

    void getMeta<ComplianceCatalog>("complianceCatalog").then((savedCatalog) => {
      if (savedCatalog?.version && savedCatalog.products?.length && savedCatalog.nextReviewDue && Number.isInteger(savedCatalog.reviewIntervalDays)) setCatalog(savedCatalog);
    });
    void Promise.all([
      getMeta<AutoBackupSettings>("autoBackupSettings"),
      getMeta<WritableBackupHandle>("autoBackupHandle"),
    ]).then(([settings, handle]) => {
      if (settings?.mode) {
        setAutoBackupSettings(settings);
        setAutoBackupStatus(settings.lastBackupAt ? "saved" : "ready");
      }
      if (handle?.kind === "file") setAutoBackupHandle(handle);
      setFilePickerSupported(typeof (window as BackupPickerWindow).showSaveFilePicker === "function");
    }).catch(() => setFilePickerSupported(typeof (window as BackupPickerWindow).showSaveFilePicker === "function"));
    void requestPersistentStorage().then(setPersistentStorage).catch(() => setPersistentStorage(false));
    let refreshingForUpdate = false;
    const reloadForUpdate = () => {
      if (!navigator.serviceWorker.controller || refreshingForUpdate) return;
      refreshingForUpdate = true;
      window.location.reload();
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate);
      void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then((registration) => navigator.onLine ? registration.update() : undefined)
        .catch(() => undefined);
    }

    const updateConnection = () => setOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.clearTimeout(quickstartTimer);
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange", reloadForUpdate);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!syncCode) return;
    const timer = window.setTimeout(() => void runDeviceSync(syncCode, false), 1800);
    return () => window.clearTimeout(timer);
  }, [dataRevision, online, runDeviceSync, syncCode]);

  useEffect(() => {
    if (!syncCode || !online) return;
    const interval = window.setInterval(() => void runDeviceSync(syncCode, false), 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [online, runDeviceSync, syncCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (online) void refreshCatalog(false);
      else setCatalogStatus("offline");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [online, refreshCatalog]);

  useEffect(() => {
    if (!online) return;
    const interval = window.setInterval(() => void refreshCatalog(false), 6 * 60 * 60 * 1000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refreshCatalog(false); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [online, refreshCatalog]);

  useEffect(() => {
    if (!online || !weatherLocation) return;
    const controller = new AbortController();
    const loadGrassTemperature = async () => {
      try {
        const year = new Date().getFullYear();
        const today = new Date().toISOString().slice(0, 10);
        const recentStartDate = new Date(); recentStartDate.setDate(recentStartDate.getDate() - 6);
        const recentStart = recentStartDate.toISOString().slice(0, 10);
        const archiveEndDate = new Date(); archiveEndDate.setDate(archiveEndDate.getDate() - 7);
        const archiveEnd = archiveEndDate.toISOString().slice(0, 10);
        const [archiveResponse, recentResponse] = await Promise.all([
          fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${weatherLocation.latitude}&longitude=${weatherLocation.longitude}&start_date=${year}-01-01&end_date=${archiveEnd}&daily=temperature_2m_mean&timezone=Europe%2FBerlin`, { signal: controller.signal }),
          fetch(`https://api.open-meteo.com/v1/forecast?latitude=${weatherLocation.latitude}&longitude=${weatherLocation.longitude}&start_date=${recentStart}&end_date=${today}&daily=temperature_2m_mean&timezone=Europe%2FBerlin`, { signal: controller.signal }),
        ]);
        if (!archiveResponse.ok || !recentResponse.ok) throw new Error("Wetterdaten nicht erreichbar");
        const responses = await Promise.all([archiveResponse.json(), recentResponse.json()]) as Array<{ daily?: { time?: string[]; temperature_2m_mean?: Array<number | null> } }>;
        const dailyValues = new Map<string, number | null>();
        responses.forEach((data) => data.daily?.time?.forEach((date, index) => dailyValues.set(date, data.daily?.temperature_2m_mean?.[index] ?? null)));
        const dates = Array.from(dailyValues.keys()).sort();
        const temperatures = dates.map((date) => dailyValues.get(date) ?? null);
        const value = temperatures.reduce((sum, temperature, index) => {
          if (temperature === null || temperature <= 0) return sum;
          const month = Number(dates[index]?.slice(5, 7));
          return sum + temperature * (month === 1 ? 0.5 : month === 2 ? 0.75 : 1);
        }, 0);
        const next = { postalCode: weatherLocation.postalCode, value: Math.round(value), calculatedThrough: dates.at(-1) || today, updatedAt: new Date().toISOString() };
        window.localStorage.setItem("bienendoku-gts-v2", JSON.stringify(next));
        setGrassTemperature(next);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) return;
      }
    };
    void loadGrassTemperature();
    return () => controller.abort();
  }, [online, weatherLocation]);

  useEffect(() => {
    if (dataRevision < 1 || !autoBackupSettings.mode) return;
    const timer = window.setTimeout(() => {
      void writeAutoBackup(autoBackupSettings.mode as Exclude<AutoBackupMode, null>, autoBackupHandle, false);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [dataRevision, autoBackupSettings.mode, autoBackupHandle, writeAutoBackup]);

  useEffect(() => {
    if (!printReport) return;
    const finish = () => setPrintReport(false);
    window.addEventListener("afterprint", finish);
    const timer = window.setTimeout(() => window.print(), 180);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finish);
    };
  }, [printReport]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("de");
    return records.filter((record) => {
      const matchesType = filter === "all" || record.type === filter;
      const haystack = `${record.title} ${record.eventDate} ${JSON.stringify(record.payload)}`.toLocaleLowerCase("de");
      return matchesType && (!term || haystack.includes(term));
    });
  }, [records, filter, search]);

  const currentYear = new Date().getFullYear();
  const recordsThisYear = records.filter((record) => record.eventDate.startsWith(String(currentYear)) && !record.payload.voided);
  const countThisYear = (type: RecordType) => recordsThisYear.filter((record) => record.type === type).length;
  const treatmentsThisYear = countThisYear("treatment");
  const inspectionsThisYear = countThisYear("inspection");
  const inspectedColoniesThisYear = recordsThisYear.filter((record) => record.type === "inspection").reduce((sum, record) => sum + (Number(record.payload.colonyCount) || 0), 0);
  const stands = records.filter((record) => record.type === "apiary");
  const colonies = records.filter((record) => record.type === "colony" && record.payload.status !== "Aufgelöst" && record.payload.status !== "Verstorben");
  const breedingSeries = records.filter((record) => record.type === "queenSeries");
  const queens = records.filter((record) => record.type === "queen");
  const activeQueens = queens.filter((record) => !["Verkauft", "Abgegeben", "Verloren", "Tot"].includes(String(record.payload.queenStatus || "")));
  const matedQueens = queens.filter((record) => record.payload.matingStatus === "Begattet");
  const breedingCalendar = breedingSeries.flatMap((record) => {
    const graftDate = record.eventDate;
    return [
      { key: `${record.id}-acceptance`, date: addDays(graftDate, 1), title: "Annahmekontrolle", series: record },
      { key: `${record.id}-sealed`, date: addDays(graftDate, 5), title: "Zellen voraussichtlich verdeckelt", series: record },
      { key: `${record.id}-cage`, date: addDays(graftDate, 10), title: "Spätester Käfigtermin", series: record },
      { key: `${record.id}-hatch`, date: addDays(graftDate, 12), title: "Erwarteter Schlupf", series: record },
      { key: `${record.id}-mating`, date: addDays(graftDate, 18), title: "Begattungskontrolle beginnen", series: record },
      { key: `${record.id}-laying`, date: addDays(graftDate, 25), title: "Eiablage kontrollieren", series: record },
    ];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const oldestTreatment = [...records].filter((record) => record.type === "treatment").sort((a, b) => a.eventDate.localeCompare(b.eventDate))[0];
  const archiveDate = oldestTreatment ? new Date(`${oldestTreatment.eventDate}T12:00:00`) : null;
  if (archiveDate) archiveDate.setFullYear(archiveDate.getFullYear() + 5);

  function openRecordCategory(type: RecordType | "all") {
    setFilter(type);
    setSearch("");
    switchView("records");
  }

  const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "BD";
  const catalogDate = new Date(`${catalog.verifiedAt}T12:00:00`).toLocaleDateString("de-DE");
  const catalogAgeDays = Math.max(0, Math.floor((currentTime - new Date(`${catalog.verifiedAt}T12:00:00`).getTime()) / 86_400_000));
  const catalogReviewOverdue = new Date(`${catalog.nextReviewDue}T23:59:59`).getTime() < currentTime;
  const nextReviewDate = new Date(`${catalog.nextReviewDue}T12:00:00`).toLocaleDateString("de-DE");
  const catalogStatusText = catalogStatus === "checking"
    ? "Katalog wird geprüft …"
    : catalogStatus === "updated"
      ? `Katalog ${catalog.version} aktualisiert`
      : catalogStatus === "current"
        ? `Katalog ${catalog.version} aktuell`
        : catalogStatus === "error"
          ? "Abgleich nicht erreichbar"
          : catalogStatus === "offline"
            ? `Offline-Katalog ${catalog.version}`
            : `Katalog ${catalog.version}`;
  const autoBackupStatusText = autoBackupStatus === "saving"
    ? "Sicherung läuft …"
    : autoBackupStatus === "permission"
      ? "Berechtigung erforderlich"
      : autoBackupStatus === "error"
        ? "Letzte Sicherung fehlgeschlagen"
        : autoBackupSettings.lastBackupAt
          ? `Zuletzt ${new Date(autoBackupSettings.lastBackupAt).toLocaleString("de-DE")}`
          : autoBackupSettings.mode
            ? "Eingerichtet · erste Sicherung steht an"
            : "Noch nicht eingerichtet";
  const reportDates = records.map((record) => record.eventDate).sort();
  const reportPeriod = reportDates.length
    ? `${formatDate(reportDates[0])} bis ${formatDate(reportDates[reportDates.length - 1])}`
    : "Noch keine Einträge";
  const roadmap = beekeeperRoadmap(grassTemperature && weatherLocation && grassTemperature.postalCode === weatherLocation.postalCode ? grassTemperature.value : null, new Date().toISOString().slice(0, 10));
  const roadmapNotes = records.filter((record) => record.type === "note").slice(0, 8);

  function switchView(view: View) {
    setActiveView(view);
    setSelected(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function dismissQuickstart(permanently = false) {
    if (permanently) window.localStorage.setItem("bienendoku-quickstart-dismissed-v1", "yes");
    setQuickstartOpen(false);
  }

  function openQuickstartTarget(view: View) {
    dismissQuickstart();
    switchView(view);
  }

  function saved(record: BeeRecord, message?: string) {
    setRecords((current) => [record, ...current]);
    setActiveForm(null);
    markDataChanged();
    setNotice(message || `${labels[record.type].label} wurde gespeichert.`);
  }

  async function removeRecord(record: BeeRecord) {
    if (!window.confirm(`„${record.title}“ wirklich löschen? Pflichtunterlagen dürfen erst nach Ablauf der Aufbewahrungsfrist gelöscht werden.`)) return;
    try {
      await deleteRecord(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setSelected(null);
      markDataChanged();
      setNotice("Eintrag und zugehörige Belege wurden lokal gelöscht.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Eintrag konnte nicht gelöscht werden.");
    }
  }

  async function voidTreatment(record: BeeRecord) {
    const reason = window.prompt("Warum wird dieser Arzneimittel-Nachweis storniert? Der ursprüngliche Eintrag bleibt unverändert nachvollziehbar.");
    if (!reason?.trim()) return;
    const updated: BeeRecord = {
      ...record,
      payload: { ...record.payload, voided: true, voidReason: reason.trim(), voidedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    try {
      await putRecord(updated);
      setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelected(updated);
      markDataChanged();
      setNotice("Arzneimittel-Nachweis wurde storniert und bleibt im lokalen Archiv erhalten.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Eintrag konnte nicht storniert werden.");
    }
  }

  async function configureAutoBackup() {
    if (filePickerSupported) {
      try {
        const picker = (window as BackupPickerWindow).showSaveFilePicker;
        if (!picker) throw new Error("Die Dateiauswahl ist in diesem Browser nicht verfügbar.");
        const handle = await picker({
          suggestedName: "Bienen-Doku-AutoBackup.json",
          types: [{ description: "Bienen Doku Sicherung", accept: { "application/json": [".json"] } }],
        });
        await putMeta("autoBackupHandle", handle);
        const settings: AutoBackupSettings = { mode: "file", fileName: handle.name, lastBackupAt: null };
        await putMeta("autoBackupSettings", settings);
        setAutoBackupHandle(handle);
        setAutoBackupSettings(settings);
        setAutoBackupStatus("ready");
        await writeAutoBackup("file", handle, true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAutoBackupStatus("error");
          setNotice(error instanceof Error ? error.message : "Auto-Backup konnte nicht eingerichtet werden.");
        }
      }
      return;
    }

    const settings: AutoBackupSettings = { mode: "download", fileName: null, lastBackupAt: null };
    await putMeta("autoBackupSettings", settings);
    setAutoBackupSettings(settings);
    setAutoBackupStatus("ready");
    setNotice("Auto-Download ist aktiv. Der Browser kann beim ersten Mal nach der Download-Erlaubnis fragen.");
    await writeAutoBackup("download", null, false);
  }

  async function disableAutoBackup() {
    const settings: AutoBackupSettings = { mode: null, fileName: null, lastBackupAt: null };
    await Promise.all([putMeta("autoBackupSettings", settings), putMeta("autoBackupHandle", null)]);
    setAutoBackupSettings(settings);
    setAutoBackupHandle(null);
    setAutoBackupStatus("off");
    setNotice("Auto-Sicherung wurde ausgeschaltet. Bereits gespeicherte Sicherungsdateien bleiben erhalten.");
  }

  async function printFullDocumentation() {
    setPrintBusy(true);
    try {
      const backup = await createBackup();
      const entries = records.map((record) => [record.id, backup.attachments.filter((attachment) => attachment.recordId === record.id)] as const);
      setPrintAttachments(Object.fromEntries(entries));
      setPrintReport(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "PDF-Dokumentation konnte nicht vorbereitet werden.");
    } finally {
      setPrintBusy(false);
    }
  }

  async function exportJson() {
    setBackupBusy(true);
    try {
      const backup = await createBackup();
      downloadContent(`bienendoku-vollbackup-${new Date().toISOString().slice(0, 10)}.json`, "application/json", JSON.stringify(backup));
      setNotice(`Vollständige Sicherung mit ${backup.records.length} Einträgen und ${backup.attachments.length} Belegen erstellt.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sicherung konnte nicht erstellt werden.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function exportReadableBackup() {
    setBackupBusy(true);
    try {
      const backup = await createBackup();
      downloadContent(`Bienen-Doku-Sichtbare-Sicherung-${new Date().toISOString().slice(0, 10)}.html`, "text/html;charset=utf-8", readableBackupHtml(backup));
      setNotice(`Sichtbare Sicherung mit ${backup.records.length} Einträgen und ${backup.attachments.length} eingebetteten Belegen erstellt.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sichtbare Sicherung konnte nicht erstellt werden.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function importJson(file: File) {
    if (file.size > 250 * 1024 * 1024) return setNotice("Die Sicherungsdatei ist größer als 250 MB.");
    if (!window.confirm("Sicherung importieren? Datensätze mit gleicher ID werden aktualisiert; andere lokale Einträge bleiben erhalten.")) return;
    setBackupBusy(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      if (file.name.toLocaleLowerCase().endsWith(".html") || text.trimStart().startsWith("<!doctype html")) {
        const document = new DOMParser().parseFromString(text, "text/html");
        const embedded = document.getElementById("bienendoku-backup")?.textContent;
        if (!embedded) throw new Error("Diese HTML-Datei enthält keine vollständigen Bienen-Doku-Wiederherstellungsdaten.");
        parsed = JSON.parse(embedded);
      } else parsed = JSON.parse(text);
      const result = await restoreBackup(parsed);
      setRecords(await listRecords());
      setSelected(null);
      markDataChanged();
      setNotice(`${result.records} Einträge und ${result.attachments} Belege wurden lokal wiederhergestellt.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sicherung konnte nicht importiert werden.");
    } finally {
      setBackupBusy(false);
      if (restoreInput.current) restoreInput.current.value = "";
    }
  }

  function exportCsv() {
    const keys = Array.from(new Set(records.flatMap((record) => Object.keys(record.payload))));
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["ID", "Typ", "Datum", "Bezeichnung", ...keys.map((key) => fieldNames[key] || key)], ...records.map((record) => [record.id, labels[record.type].label, record.eventDate, record.title, ...keys.map((key) => record.payload[key] ?? "")])];
    downloadContent(`bienendoku-export-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8", `\uFEFF${rows.map((row) => row.map(escape).join(";")).join("\n")}`);
  }

  function timeline(items: BeeRecord[], limit?: number) {
    const shown = typeof limit === "number" ? items.slice(0, limit) : items;
    return (
      <div className="timeline">
        {loading && <div className="empty">Einträge werden geladen …</div>}
        {!loading && !shown.length && <div className="empty"><span>☘</span><b>Noch keine passenden Einträge</b><p>Lege einen neuen Datensatz an. Die App sortiert und archiviert ihn automatisch.</p><button className="button secondary" onClick={() => setActiveForm("chooser")}>Eintrag anlegen</button></div>}
        {shown.map((record) => {
          const item = labels[record.type];
          return <button className={`timeline-row ${record.payload.voided ? "voided-row" : ""}`} key={record.id} onClick={() => setSelected(record)}><span className={`quick-icon ${item.tone}`}>{item.icon}</span><span className="timeline-copy"><small>{item.label}{record.payload.voided ? " · storniert" : ""}</small><b>{record.title}</b><span>{String(record.payload.notes || record.payload.indication || record.payload.location || item.short)}</span></span><time>{formatDate(record.eventDate)}</time><i>›</i></button>;
        })}
      </div>
    );
  }

  const Dashboard = () => (
    <>
      <section className="brand-showcase" aria-label="Bienen Doku von Bienen Kruska">
        <Image className="creator-logo-small" src="/bienen-kruska-logo.png" alt="Bienen Kruska – Honig aus eigener Imkerei, Krümmel Westerwald" width={2048} height={2048} priority />
        <h1>Bienen Doku</h1>
        <div className="inspiration"><span>Inspiriert von</span><Image src="/beelive-logo.png" alt="Bee Live – Imkern wie da Jupp" width={339} height={149} /></div>
      </section>

      <section className="weather-feature" aria-label="Grünlandtemperatursumme">
        <span className="weather-feature-icon" aria-hidden="true"><i /></span>
        <div><small>Grünlandtemperatursumme</small>{weatherLocation ? <><strong>{grassTemperature?.postalCode === weatherLocation.postalCode ? `${grassTemperature.value}°` : "…"}</strong><span>PLZ {weatherLocation.postalCode}{grassTemperature?.postalCode === weatherLocation.postalCode ? ` · Stand ${formatDate(grassTemperature.calculatedThrough)}` : online ? " · wird geladen" : " · offline"}</span>{grassTemperature?.postalCode === weatherLocation.postalCode && <p className="weather-bloom"><b>Was blüht:</b> {typicalBloomForGlt(grassTemperature.value, grassTemperature.calculatedThrough)}</p>}<button type="button" onClick={() => { window.localStorage.removeItem("bienendoku-weather-location-v1"); setWeatherLocation(null); }}>PLZ ändern</button></> : <><strong className="weather-placeholder">PLZ</strong><span>Eigene Wetterregion festlegen</span><div className="postal-entry"><input value={postalCodeInput} onChange={(event) => setPostalCodeInput(event.target.value.replace(/\D/g, "").slice(0, 5))} onKeyDown={(event) => { if (event.key === "Enter") void saveWeatherPostalCode(); }} inputMode="numeric" autoComplete="postal-code" aria-label="Deutsche Postleitzahl" placeholder="z. B. 56244" /><button type="button" onClick={() => void saveWeatherPostalCode()}>Speichern</button></div></>}</div>
      </section>

      <section className="roadmap-card" aria-label="Imker-Fahrplan">
        <header><span className="roadmap-icon">☘</span><div><small>Imker-/Tracht-Fahrplan · {weatherLocation ? `PLZ ${weatherLocation.postalCode}` : "PLZ noch festlegen"}</small><h2>{roadmap.phase}</h2><p>{roadmap.focus}</p></div><button onClick={() => setActiveForm("note")}>＋ Notiz</button></header>
        <div className="roadmap-tasks">{roadmap.tasks.map((task) => <span key={task}>✓ {task}</span>)}</div>
        <section className="roadmap-whiteboard" aria-label="Notiz-Whiteboard"><div className="whiteboard-head"><div><small>Whiteboard</small><h3>Notizen zum Fahrplan</h3></div><div><button onClick={() => setActiveForm("note")}>＋ Neue Notiz</button>{roadmapNotes.length > 0 && <button onClick={() => openRecordCategory("note")}>Alle Notizen →</button>}</div></div>{roadmapNotes.length ? <div className="whiteboard-grid">{roadmapNotes.map((record, index) => <article className={`whiteboard-note note-tone-${index % 4}`} key={record.id}><span className="note-pin" aria-hidden="true"/><button className="note-open" onClick={() => setSelected(record)}><small>{formatDate(record.eventDate)}{record.payload.apiary ? ` · ${String(record.payload.apiary)}` : ""}</small><b>{String(record.payload.noteTitle || "Notiz")}</b><p>{String(record.payload.notes || "")}</p>{record.payload.colonies && <em>Volk: {String(record.payload.colonies)}</em>}</button><button className="note-delete" onClick={() => void removeRecord(record)} aria-label={`${String(record.payload.noteTitle || "Notiz")} löschen`}>Löschen</button></article>)}</div> : <button className="whiteboard-empty" onClick={() => setActiveForm("note")}><span>✎</span><b>Noch keine Notiz am Fahrplan</b><small>Antippen oder im Sprachmodus „Notiz“ sagen.</small></button>}</section>
        <footer>Orientierung nach Datum, lokaler GLT und typischer Vegetationsphase. Wetter, Tracht und tatsächlichen Volkszustand immer vor Ort prüfen.</footer>
      </section>

      <section className={`local-status-card ${online ? "is-online" : "is-offline"}`}>
        <span className="local-status-icon">{online ? "✓" : "⌁"}</span>
        <div><b>{online ? "Online · automatischer Rechts-, Katalog- und Quellenabgleich aktiv" : "Offline bereit · letzter geprüfter Stand bleibt verfügbar"}</b><p>Die App prüft beim Online-Start, bei Rückkehr in die App und alle sechs Stunden auf eine veröffentlichte Aktualisierung und die Erreichbarkeit der amtlichen Hauptquellen. Persönliche Daten bleiben lokal.{lastOnlineCatalogCheck ? ` Letzter Online-Abgleich: ${new Date(lastOnlineCatalogCheck).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.` : ""}{sourceCheck ? ` Amtliche Quellen: ${sourceCheck.allReachable ? "erreichbar" : "teilweise nicht erreichbar"}.` : ""}</p></div>
        <button onClick={() => void refreshCatalog(true)} disabled={!online || catalogStatus === "checking"}>{online ? catalogStatusText : "Offline-Katalog aktiv"}</button>
      </section>

      <section className={`catalog-freshness ${catalogReviewOverdue ? "is-overdue" : ""}`}>
        <span>{catalogReviewOverdue ? "!" : "✓"}</span><div><b>{catalogReviewOverdue ? "Fachliche Überprüfung überfällig" : "Rechts- und Richtlinienstand geprüft"}</b><p>Geprüft am {catalogDate} · {catalogAgeDays} Tage alt · nächste Prüfung spätestens {nextReviewDate}. {catalogReviewOverdue ? "Vor einer Behandlung unbedingt die amtlichen Quellen und Packungsbeilage direkt prüfen." : "Freigegebene Fachstände werden automatisch geladen; die amtlichen Hauptquellen werden zusätzlich online überwacht."}</p></div><button onClick={() => switchView("legal")}>Quellen ansehen →</button>
      </section>

      <section className="alert-card">
        <span className="alert-icon">!</span>
        <div><b>Neu seit März 2026: Varroose ist meldepflichtig</b><p>Bei Nachweis oder begründetem Verdacht verlangt die neue Verordnung eine unverzügliche Meldung. Das genaue Vorgehen bitte mit deinem Veterinäramt klären.</p></div>
        <button onClick={() => switchView("legal")}>Details <span>→</span></button>
      </section>

      <section className="stats-grid" aria-label="Übersicht">
        <button type="button" className="stat-card clickable-stat" onClick={() => openRecordCategory("treatment")} aria-label="Behandlungen öffnen"><span className="stat-icon amber">✚</span><div><small>Behandlungen {currentYear}</small><strong>{treatmentsThisYear}</strong><span>{treatmentsThisYear ? "dokumentiert · öffnen →" : "Einträge öffnen →"}</span></div></button>
        <button type="button" className="stat-card clickable-stat" onClick={() => openRecordCategory("inspection")} aria-label="Durchsichten öffnen"><span className="stat-icon green">⌕</span><div><small>Durchsichten {currentYear}</small><strong>{inspectionsThisYear}</strong><span>{inspectedColoniesThisYear ? `${inspectedColoniesThisYear} Völker kontrolliert · öffnen →` : "Einträge öffnen →"}</span></div></button>
        <button type="button" className="stat-card clickable-stat" onClick={() => openRecordCategory("feeding")} aria-label="Fütterungen öffnen"><span className="stat-icon gold">⌁</span><div><small>Fütterungen {currentYear}</small><strong>{countThisYear("feeding")}</strong><span>dokumentierte Einträge · öffnen →</span></div></button>
        <button type="button" className="stat-card clickable-stat" onClick={() => openRecordCategory("harvest")} aria-label="Honigernten öffnen"><span className="stat-icon amber">◇</span><div><small>Honigernten {currentYear}</small><strong>{countThisYear("harvest")}</strong><span>dokumentierte Chargen · öffnen →</span></div></button>
        <button type="button" className="stat-card clickable-stat" onClick={() => openRecordCategory("hygiene")} aria-label="Hygiene-Einträge öffnen"><span className="stat-icon blue">✓</span><div><small>Hygiene {currentYear}</small><strong>{countThisYear("hygiene")}</strong><span>Kontrollen und Maßnahmen · öffnen →</span></div></button>
        <button type="button" className="stat-card clickable-stat" onClick={() => openRecordCategory("disease")} aria-label="Krankheits- und Verdachtseinträge öffnen"><span className="stat-icon red">!</span><div><small>Krankheit / Verdacht {currentYear}</small><strong>{countThisYear("disease")}</strong><span>dokumentierte Vorgänge · öffnen →</span></div></button>
        <button type="button" className="stat-card clickable-stat breeding-stat" onClick={() => switchView("breeding")} aria-label="Königinnenzucht öffnen"><span className="stat-icon gold">♛</span><div><small>Königinnenzucht {currentYear}</small><strong>{breedingSeries.filter((record) => record.eventDate.startsWith(String(currentYear))).length}</strong><span>{activeQueens.length} aktive Königinnen · öffnen →</span></div></button>
        <button type="button" className="stat-card clickable-stat" onClick={() => switchView("apiaries")} aria-label="Stände und Völker öffnen"><span className="stat-icon green">⬡</span><div><small>Aktive Völker</small><strong>{colonies.length}</strong><span>an {stands.length} Bienenständen · öffnen →</span></div></button>
        <button type="button" className="stat-card clickable-stat" onClick={() => openRecordCategory("treatment")} aria-label="Behandlungsarchiv öffnen"><span className="stat-icon blue">▣</span><div><small>5-Jahres-Archiv</small><strong className="date-stat">{archiveDate ? archiveDate.toLocaleDateString("de-DE", { month: "short", year: "numeric" }) : "—"}</strong><span>Behandlungsarchiv öffnen →</span></div></button>
      </section>

      <section className="quick-section">
        <div className="section-heading"><div><p className="eyebrow">Schnellerfassung</p><h2>Was möchtest du dokumentieren?</h2></div><p>Relevante Pflichtfelder sind markiert.</p></div>
        <div className="quick-grid">
          {primaryTypes.map((type) => {
            const item = labels[type];
            return <button key={type} className="quick-card" onClick={() => setActiveForm(type)}><span className={`quick-icon ${item.tone}`}>{item.icon}</span><span><b>{item.label}</b><small>{item.short}</small></span><i>→</i></button>;
          })}
        </div>
      </section>

      <section className="log-section">
        <div className="section-heading"><div><p className="eyebrow">Chronik</p><h2>Letzte Einträge</h2></div><button className="text-button" onClick={() => switchView("records")}>Alle anzeigen →</button></div>
        {timeline(records, 6)}
      </section>

      <section className="legal-strip"><div><span className="eyebrow">Prüfkatalog · verifiziert am {catalogDate} · nächste Prüfung {nextReviewDate}</span><h2>Vier Bereiche, die die App abdeckt</h2></div><div className="legal-pills"><span>Tierarzneimittel · 5 Jahre</span><span>Lebensmittelhygiene</span><span>Rückverfolgbarkeit</span><span>Tierseuchenmeldung</span></div><p>Online wird automatisch nach freigegebenen Aktualisierungen gesucht. Die fachliche Prüfung und Veröffentlichung erfolgt kontrolliert, weil Gesetzesänderungen nicht zuverlässig automatisch ausgelegt werden können. Maßgeblich bleiben amtliche Quellen, aktuelle Zulassung und Packungsbeilage.</p></section>
    </>
  );

  const RecordsView = () => (
    <section className="page-view">
      <div className="page-title"><div><p className="eyebrow">Betriebschronik</p><h1>Alle Einträge</h1><p>{visible.length} von {records.length} Datensätzen</p></div><button className="button primary" onClick={() => setActiveForm("chooser")}>＋ Hinzufügen</button></div>
      <div className="record-tools"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Völker, Charge, Mittel …" /></label><div className="filters"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Alle</button>{primaryTypes.map((type) => <button key={type} className={filter === type ? "active" : ""} onClick={() => setFilter(type)}>{labels[type].label}</button>)}</div></div>
      {timeline(visible)}
    </section>
  );

  const ApiariesView = () => (
    <section className="page-view">
      <div className="page-title"><div><p className="eyebrow">Stammdaten</p><h1>Stände & Völker</h1><p>Eindeutige Zuordnung für jeden Nachweis.</p></div><div className="button-pair"><button className="button ghost" onClick={() => setActiveForm("apiary")}>＋ Bienenstand</button><button className="button primary" onClick={() => setActiveForm("colony")}>＋ Bienenvolk</button></div></div>
      <div className="master-grid">
        <article className="master-card"><div className="master-head"><span className="stat-icon green">⌂</span><div><small>Bienenstände</small><strong>{stands.length}</strong></div></div>{stands.length ? stands.map((record) => <button key={record.id} onClick={() => setSelected(record)}><b>{String(record.payload.name || record.title)}</b><span>{String(record.payload.location || "Kein Standort")}</span><i>›</i></button>) : <div className="mini-empty">Noch kein Stand angelegt.</div>}<button className="inline-add" onClick={() => setActiveForm("apiary")}>＋ Stand anlegen</button></article>
        <article className="master-card"><div className="master-head"><span className="stat-icon gold">⬡</span><div><small>Aktive Völker</small><strong>{colonies.length}</strong></div></div>{colonies.length ? colonies.map((record) => <button key={record.id} onClick={() => setSelected(record)}><b>{String(record.payload.colonyId || record.title)}</b><span>{String(record.payload.apiary || "Kein Stand")} · {String(record.payload.hiveSystem || "Beute nicht angegeben")} · {String(record.payload.status || "Aktiv")}</span><i>›</i></button>) : <div className="mini-empty">Noch kein Volk angelegt.</div>}<button className="inline-add" onClick={() => setActiveForm("colony")}>＋ Volk anlegen</button></article>
      </div>
      <div className="info-card"><span>i</span><div><b>Anzeigepflicht des Bienenstands</b><p>Wer Bienen halten will, muss dies spätestens bei Tätigkeitsbeginn bei der zuständigen Behörde unter Angabe von Völkerzahl und Standort anzeigen (§ 1a Bienenseuchen-Verordnung).</p></div></div>
    </section>
  );

  const BreedingView = () => (
    <section className="page-view breeding-view">
      <div className="page-title"><div><p className="eyebrow">Zuchtbuch & Terminplanung</p><h1>Königinnenzucht</h1><p>Vom Umlarven über Schlupf und Begattung bis zur eingeweiselten Königin.</p></div><div className="button-pair"><button className="button ghost" onClick={() => setActiveForm("queenSeries")}>＋ Zuchtserie</button><button className="button primary" onClick={() => setActiveForm("queen")}>＋ Königin</button></div></div>
      <div className="breeding-summary">
        <article><span>♛</span><small>Zuchtserien</small><strong>{breedingSeries.length}</strong></article>
        <article><span>◉</span><small>Angenommene Zellen</small><strong>{breedingSeries.reduce((sum, record) => sum + (Number(record.payload.acceptedCount) || 0), 0)}</strong></article>
        <article><span>◇</span><small>Geschlüpft</small><strong>{breedingSeries.reduce((sum, record) => sum + (Number(record.payload.hatchedCount) || 0), 0)}</strong></article>
        <article><span>✓</span><small>Begattet</small><strong>{matedQueens.length}</strong></article>
      </div>
      <div className="breeding-columns">
        <section className="breeding-panel"><header><div><p className="eyebrow">Zuchtkalender</p><h2>Nächste Arbeitsschritte</h2></div></header>{breedingCalendar.length ? <div className="breeding-calendar">{breedingCalendar.map((item) => <button key={item.key} onClick={() => setSelected(item.series)}><time>{formatDate(item.date)}</time><span><b>{item.title}</b><small>{String(item.series.payload.seriesName || item.series.title)}</small></span><i className={new Date(`${item.date}T23:59:59`).getTime() < Date.now() ? "overdue" : ""}>{breedingDueLabel(item.date)}</i></button>)}</div> : <div className="mini-empty">Lege eine Zuchtserie an. Alle Folgetermine werden automatisch berechnet.</div>}</section>
        <section className="breeding-panel"><header><div><p className="eyebrow">Königinnenbestand</p><h2>Königinnen</h2></div><button className="text-button" onClick={() => openRecordCategory("queen")}>Alle öffnen →</button></header>{queens.length ? <div className="queen-list">{queens.map((record) => <button key={record.id} onClick={() => setSelected(record)}><span className="queen-year-color" aria-hidden="true">{String(record.eventDate).slice(0, 4)}</span><span><b>{String(record.payload.queenId || record.title)}</b><small>{String(record.payload.matingStatus || "Status offen")} · {String(record.payload.queenStatus || "ohne Bestandsstatus")}</small></span><i>›</i></button>)}</div> : <div className="mini-empty">Noch keine einzelne Königin angelegt.</div>}</section>
      </div>
      <section className="breeding-panel series-panel"><header><div><p className="eyebrow">Serienübersicht</p><h2>Laufende und abgeschlossene Zuchtserien</h2></div><button className="text-button" onClick={() => openRecordCategory("queenSeries")}>Alle öffnen →</button></header>{breedingSeries.length ? <div className="series-grid">{breedingSeries.map((record) => <button key={record.id} onClick={() => setSelected(record)}><span className="stat-icon gold">♛</span><span><b>{String(record.payload.seriesName || record.title)}</b><small>Umlarven {formatDate(record.eventDate)} · {String(record.payload.acceptedCount || 0)} angenommen · {String(record.payload.hatchedCount || 0)} geschlüpft</small></span><i>›</i></button>)}</div> : <div className="mini-empty">Noch keine Zuchtserie dokumentiert.</div>}</section>
      <div className="info-card"><span>i</span><div><b>Biologische Richtwerte</b><p>Die automatisch berechneten Termine sind Planungswerte ab dem Umlarvdatum. Entwicklungsdauer, Pflegezustand und Temperatur können abweichen. Vor jedem Eingriff die tatsächliche Entwicklung der Zellen kontrollieren.</p></div></div>
    </section>
  );

  const ExportView = () => (
    <section className="page-view">
      <div className="page-title"><div><p className="eyebrow">Sicherung & Kontrolle</p><h1>Export & Archiv</h1><p>Halte Kopien außerhalb der App vor.</p></div></div>
      <div className="export-grid">
        <article className={`export-card sync-card ${syncCode ? "active" : ""}`}><span className="export-icon">⇄</span><h2>Smartphone & PC automatisch abgleichen</h2><p>Freiwillige Ende-zu-Ende-verschlüsselte Synchronisierung. Änderungen werden online automatisch zusammengeführt; offline arbeitest du normal weiter.</p><div className="backup-status"><b>{syncCode ? (syncStatus === "syncing" ? "Abgleich läuft" : syncStatus === "error" ? "Fehler" : syncStatus === "offline" ? "Offline" : "Aktiv") : "Aus"}</b><span>{lastSyncedAt ? `Zuletzt synchronisiert: ${new Date(lastSyncedAt).toLocaleString("de-DE")}` : syncCode ? "Automatischer Abgleich ist eingerichtet." : "Auf einem Gerät neu einrichten oder vorhandenen Code verbinden."}</span>{syncCode && <small className="sync-code">{syncCode}</small>}</div><div className="export-actions">{!syncCode ? <><button className="button primary" onClick={startNewSync}>Neue Synchronisierung</button><button className="button ghost" onClick={connectExistingSync}>Vorhandenen Code verbinden</button></> : <><button className="button primary" disabled={syncStatus === "syncing" || !online} onClick={() => void runDeviceSync(syncCode, true)}>Jetzt abgleichen</button><button className="button ghost" onClick={() => void navigator.clipboard.writeText(syncCode).then(() => setNotice("Sync-Code wurde kopiert."))}>Code kopieren</button><button className="button ghost" onClick={disableDeviceSync}>Ausschalten</button></>}</div>{syncCode && <small className="sync-warning">Den Sync-Code wie ein Passwort behandeln und sicher aufbewahren. Wer ihn kennt, kann die synchronisierten Daten lesen.</small>}</article>
        <article className={`export-card auto-backup-card ${autoBackupSettings.mode ? "active" : ""}`}><span className="export-icon">↻</span><h2>Auto-Sicherung</h2><p>{filePickerSupported ? "Wähle einmal eine Sicherungsdatei außerhalb des Browsers. Sie wird nach jeder Änderung automatisch überschrieben." : "Dieser Browser nutzt den Download-Modus: Nach Änderungen wird automatisch eine neue Sicherung im Download-Ordner angelegt."}</p><div className="backup-status"><b>{autoBackupSettings.mode ? "Aktiv" : "Aus"}</b><span>{autoBackupStatusText}</span>{autoBackupSettings.fileName && <small>{autoBackupSettings.fileName}</small>}</div><div className="export-actions">{!autoBackupSettings.mode ? <button className="button primary" onClick={() => void configureAutoBackup()}>Auto-Sicherung einrichten</button> : <><button className="button primary" disabled={autoBackupStatus === "saving"} onClick={() => void writeAutoBackup(autoBackupSettings.mode as Exclude<AutoBackupMode, null>, autoBackupHandle, true)}>{autoBackupStatus === "permission" ? "Berechtigung erneuern" : "Jetzt sichern"}</button><button className="button ghost" onClick={() => void disableAutoBackup()}>Ausschalten</button></>}</div></article>
        <article className="export-card"><span className="export-icon">{`{ }`}</span><h2>Vollständiges Backup</h2><p>Die JSON-Datei dient zur sicheren Wiederherstellung. Die sichtbare HTML-Sicherung zeigt Bilder und PDFs direkt an und enthält ebenfalls alle Wiederherstellungsdaten.</p><div className="export-actions"><button className="button primary" disabled={backupBusy} onClick={() => void exportReadableBackup()}>{backupBusy ? "Bitte warten …" : "Sichtbare Sicherung"}</button><button className="button ghost" disabled={backupBusy} onClick={() => void exportJson()}>Technisches JSON-Backup</button></div></article>
        <article className="export-card"><span className="export-icon">▦</span><h2>Tabellen-Export</h2><p>Alle Einträge als UTF-8-CSV mit Semikolon – geeignet für Excel, LibreOffice und Archivierung.</p><button className="button primary" onClick={exportCsv}>CSV herunterladen</button></article>
        <article className="export-card"><span className="export-icon">↥</span><h2>Sicherung einspielen</h2><p>Stellt Einträge und Belege aus einer sichtbaren HTML- oder technischen JSON-Sicherung wieder her. Vorhandene andere Datensätze bleiben bestehen.</p><button className="button primary" disabled={backupBusy} onClick={() => restoreInput.current?.click()}>Backup auswählen</button><input ref={restoreInput} className="hidden-file" type="file" accept="application/json,text/html,.json,.html" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importJson(file); }} /></article>
        <article className="export-card pdf-card"><span className="export-icon">PDF</span><h2>Gesamtdokumentation</h2><p>Bereitet alle Einträge, Pflichtfelder, Stornierungen und Belegnamen als vollständige A4-Dokumentation vor.</p><button className="button primary" disabled={printBusy} onClick={() => void printFullDocumentation()}>{printBusy ? "Wird vorbereitet …" : "Als PDF drucken"}</button><small>Im Druckfenster „Als PDF speichern“ auswählen.</small></article>
      </div>
      <div className="archive-warning"><span>!</span><div><b>Auto-Sicherung schützt außerhalb des Browsers</b><p>Arzneimittel-Aufzeichnungen müssen mindestens fünf Jahre verfügbar bleiben. Die Auto-Sicherung speichert eine vollständige Kopie einschließlich Belegen außerhalb der Browserdaten. Im Download-Modus können mehrere Sicherungsdateien entstehen. Dauerhafter Browser-Speicher: {persistentStorage === null ? "wird geprüft" : persistentStorage ? "aktiv" : "nicht garantiert"}.</p></div></div>
    </section>
  );

  const LegalView = () => (
    <section className="page-view legal-view">
      <div className="page-title"><div><p className="eyebrow">Deutschland · Katalog {catalog.version}</p><h1>Pflichten & Quellen</h1><p>Amtliche Rechtsquellen, verständlich den App-Bereichen zugeordnet.</p></div><button className="button primary" disabled={!online || catalogStatus === "checking"} onClick={() => void refreshCatalog(true)}>{online ? "Jetzt online prüfen" : "Offline"}</button></div>
      <div className="legal-grid">
        <article><span className="legal-number">01</span><div><h2>Tierarzneimittel</h2><p>Für lebensmittelliefernde Tiere sind u. a. Datum der ersten Gabe, Mittel, Menge, Lieferant, Erwerbsbeleg, Tier-/Gruppenidentität, gegebenenfalls Tierarzt, Wartezeit – auch wenn sie 0 beträgt – und Behandlungsdauer festzuhalten. Bei Bienen meint die Wartezeit den Mindestzeitraum nach der letzten Anwendung bis Honig für den menschlichen Verzehr gewonnen werden darf; sie ist nicht die Behandlungsdauer. Bereithaltung: mindestens fünf Jahre.</p><a href="https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX%3A02019R0006-20220128" target="_blank" rel="noreferrer">Art. 4 Nr. 34 und Art. 108 VO (EU) 2019/6 ↗</a></div></article>
        <article><span className="legal-number">02</span><div><h2>Lebensmittelhygiene</h2><p>Primärerzeuger müssen insbesondere über verfütterte Futtermittel, Tierarzneimittel und Behandlungen, relevante Krankheiten sowie wichtige Analyseergebnisse Buch führen.</p><a href="https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX%3A02004R0852-20210324" target="_blank" rel="noreferrer">Anhang I VO (EG) 852/2004 ↗</a></div></article>
        <article><span className="legal-number">03</span><div><h2>Rückverfolgbarkeit</h2><p>Lebensmittelunternehmer müssen Lieferanten und betriebliche Abnehmer feststellen können. Eine saubere Los-/Chargenverknüpfung erleichtert Rückruf und Nachweis.</p><a href="https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX%3A02002R0178-20240701" target="_blank" rel="noreferrer">Art. 18 VO (EG) 178/2002 ↗</a></div></article>
        <article><span className="legal-number">04</span><div><h2>Bienenhaltung anzeigen</h2><p>Völkerzahl und Standort sind spätestens zu Beginn der Bienenhaltung der zuständigen Behörde anzuzeigen. Diese erteilt eine Registernummer.</p><a href="https://www.gesetze-im-internet.de/bienseuchv/__1a.html" target="_blank" rel="noreferrer">§ 1a BienSeuchV ↗</a></div></article>
        <article className="wide-legal"><span className="legal-number red-number">05</span><div><h2>Tierseuchenmeldung seit März 2026</h2><p>Amerikanische Faulbrut, Kleiner Bienenbeutenkäfer und Tropilaelaps sind nach der neuen Tierseuchenmeldeverordnung erfasst. In Anlage 2 ist nun auch Varroose aufgeführt. § 3 verlangt bei Nachweis oder Verdachtsgründen grundsätzlich eine unverzügliche Meldung; § 5 nennt die erforderlichen Angaben. Weil Varroa verbreitet ist und die praktische Auslegung entscheidend ist, sollte das konkrete Meldeverfahren mit dem örtlichen Veterinäramt geklärt werden.</p><a href="https://www.gesetze-im-internet.de/tierseuchmeldv/BJNR03D0B0026.html" target="_blank" rel="noreferrer">TierSeuchMeldV – amtlicher Volltext ↗</a></div></article>
        <article className="wide-legal"><span className="legal-number">06</span><div><h2>Zugelassene Varroamittel</h2><p>Der lokale Katalog enthält {catalog.products.length} Präparate aus der amtlichen LWG-Übersicht, Produktlistenstand {catalog.productListDate}. Der Katalog wurde am {catalogDate} gegen die angegebenen Quellen geprüft; die nächste kontrollierte Überprüfung ist spätestens am {nextReviewDate} vorgesehen. Zulassungen, Vertriebsfristen und Anwendungsbedingungen können sich jederzeit ändern; verbindlich sind aktueller Zulassungsstatus und Packungsbeilage.</p><div className="source-links"><a href={VARROA_SOURCE_URL} target="_blank" rel="noreferrer">LWG-Präparateliste ↗</a><a href={UPD_URL} target="_blank" rel="noreferrer">EU-Tierarzneimittel-Datenbank ↗</a></div></div></article>
        <article className="wide-legal"><span className="legal-number">07</span><div><h2>Behandlungsmethoden im Prüfkatalog</h2><div className="method-list">{catalog.methods.map((method) => <div key={method.id}><b>{method.title}</b><small>{method.category}</small><p>{method.guidance}</p></div>)}</div><p>{catalog.notice}</p></div></article>
      </div>
      <div className="legal-disclaimer"><b>Rechtlicher Hinweis · Erstellt von T. Kruska</b><p>Diese Zuordnung ist eine Arbeitshilfe und keine Rechtsberatung. Maßgeblich sind der amtliche Wortlaut, die aktuelle Arzneimittelzulassung und Packungsbeilage sowie Anordnungen und Auskünfte der zuständigen Behörde. Vorgaben können sich ändern oder regional ergänzt werden.</p></div>
    </section>
  );

  const HelpView = () => (
    <section className="page-view help-view">
      <div className="page-title"><div><p className="eyebrow">Bedienungsanleitung</p><h1>Hilfe & Handbuch</h1><p>Vom ersten Öffnen bis zur sicheren Langzeitablage.</p></div><div className="button-pair"><button className="button ghost" onClick={() => setQuickstartOpen(true)}>Schnellstart anzeigen</button><button className="button primary" onClick={() => window.print()}>Handbuch drucken / als PDF</button></div></div>

      <section className="manual-intro">
        <span className="manual-badge">5 Minuten</span>
        <div><h2>Schnellstart</h2><p>Öffne die App einmal mit Internet, installiere sie auf Wunsch und richte als Erstes die Auto-Sicherung ein. Danach kannst du Stände, Völker und Nachweise auch ohne Internet erfassen.</p></div>
      </section>

      <nav className="manual-toc" aria-label="Inhalt des Handbuchs">
        <a href="#handbuch-zugang">Zugang & Installation</a>
        <a href="#handbuch-erste-schritte">Erste Schritte</a>
        <a href="#handbuch-dokumentieren">Dokumentieren</a>
        <a href="#handbuch-sichern">Sichern & PDF</a>
        <a href="#handbuch-teilen">App weitergeben</a>
        <a href="#handbuch-fehler">Problemlösung</a>
      </nav>

      <div className="manual-grid">
        <article id="handbuch-zugang" className="manual-card">
          <span className="manual-number">01</span><div><h2>Zugang & Installation</h2><ol><li>Den App-Link in Chrome, Edge oder Safari öffnen.</li><li>Im Browser „App installieren“, „Zum Startbildschirm“ oder „Zum Home-Bildschirm“ wählen.</li><li>Die App einmal vollständig laden. Danach steht sie auch offline bereit.</li></ol><p className="manual-note"><b>Wichtig:</b> Ohne bewusst eingerichtete Synchronisierung hat jeder Browser einen eigenen, getrennten Datenbestand.</p></div>
        </article>

        <article id="handbuch-erste-schritte" className="manual-card">
          <span className="manual-number">02</span><div><h2>Erste Schritte</h2><ol><li>Unter „Export“ die <b>Auto-Sicherung</b> einrichten und eine Datei außerhalb des Browsers wählen.</li><li>Unter „Stände & Völker“ zuerst Bienenstände und anschließend die Völker anlegen.</li><li>Über „Neuer Eintrag“ den ersten Nachweis erfassen. Pflichtfelder sind mit * gekennzeichnet.</li></ol><p className="manual-note">Bei Browsern ohne direkten Dateizugriff landen automatische Sicherungen im Download-Ordner. Automatische Downloads gegebenenfalls erlauben.</p></div>
        </article>

        <article id="handbuch-dokumentieren" className="manual-card wide-manual">
          <span className="manual-number">03</span><div><h2>Einträge, Belege und Korrekturen</h2><div className="manual-columns"><div><h3>Eintrag erfassen</h3><p>Die passende Kategorie wählen, Daten eintragen und speichern. Für Varroabehandlungen steht der versionierte Offline-Katalog aus der LWG-Übersicht bereit. Vor jeder Anwendung den aktuellen Zulassungsstatus und die Packungsbeilage prüfen.</p></div><div><h3>Wartezeit für Honig</h3><p>Die Wartezeit ist der Mindestzeitraum nach der letzten Anwendung, bevor Honig für Menschen gewonnen werden darf. Sie ist nicht Behandlungsdauer, Wechselintervall oder Streifen-Verweildauer. Auch bei 0 Tagen zusätzliche Tracht- und Honigraumvorgaben der Packungsbeilage eintragen.</p></div><div><h3>Mehrere Belege anhängen</h3><p>Bis zu fünf Rechnungen, PDFs, Fotos oder andere Nachweise gleichzeitig auswählen. Vor dem Speichern werden alle Dateien aufgelistet und können einzeln entfernt werden. Nach dem Speichern sind sie in der Detailansicht sichtbar, herunterladbar und durch weitere Dateien ergänzbar.</p></div><div><h3>Fehler berichtigen</h3><p>Arzneimittel-Nachweise werden nicht spurlos gelöscht, sondern mit Begründung storniert. Das Original bleibt nachvollziehbar erhalten.</p></div></div></div>
        </article>

        <article id="handbuch-sichern" className="manual-card wide-manual">
          <span className="manual-number">04</span><div><h2>Sichern, wiederherstellen und PDF erstellen</h2><div className="manual-columns"><div><h3>Auto-Sicherung</h3><p>Nach jeder Änderung wird eine vollständige technische Sicherung einschließlich Belegen geschrieben. Nach einem Browser-Neustart kann die Schreibberechtigung erneut verlangt werden.</p></div><div><h3>Sichtbare Sicherung</h3><p>Unter „Export“ die sichtbare HTML-Sicherung herunterladen. Bilder werden direkt angezeigt, PDFs eingebettet und andere Dokumente lassen sich öffnen. Die Datei kann auch wieder in die App eingespielt werden.</p></div><div><h3>Wiederherstellung</h3><p>App neu öffnen, „Sicherung einspielen“ wählen und die HTML- oder JSON-Datei auswählen. Einträge und Belege werden wieder lokal in diesem Browser angelegt.</p></div><div><h3>Dokumentation als PDF</h3><p>„Als PDF drucken“ wählen. Im Druckfenster als Ziel „Als PDF speichern“ auswählen. Bildbelege und PDF-Ansichten werden nach Möglichkeit direkt beim Eintrag dargestellt.</p></div></div></div>
        </article>

        <article id="handbuch-teilen" className="manual-card share-manual">
          <span className="manual-number">05</span><div><h2>Die App an andere weitergeben</h2><p>Nach öffentlicher Freigabe genügt derselbe App-Link. Der Link verteilt nur die Anwendung und gibt keine persönlichen Daten weiter. Ein Datenaustausch findet erst statt, wenn ein Vollbackup bewusst geteilt oder derselbe persönliche Sync-Code auf mehreren Geräten eingerichtet wird.</p><ul><li>Jede Person richtet ihre eigene Sicherung ein.</li><li>Sync-Codes wie Passwörter behandeln und nicht öffentlich weitergeben.</li><li>Ohne gemeinsamen Sync-Code oder Backup bleiben die Datenbestände getrennt.</li></ul></div>
        </article>

        <article id="handbuch-fehler" className="manual-card">
          <span className="manual-number">06</span><div><h2>Problemlösung</h2><dl className="manual-faq"><div><dt>App startet nicht offline</dt><dd>Einmal online vollständig öffnen und anschließend erneut versuchen.</dd></div><div><dt>Auto-Sicherung meldet Berechtigung</dt><dd>Unter „Export“ auf „Berechtigung erneuern“ klicken.</dd></div><div><dt>Keine Sicherungsdatei sichtbar</dt><dd>Download-Ordner prüfen und automatische Downloads für die Seite erlauben.</dd></div><div><dt>Browserdaten wurden gelöscht</dt><dd>App erneut öffnen oder installieren und das letzte Vollbackup einspielen.</dd></div></dl></div>
        </article>
      </div>

      <div className="manual-final"><span>✓</span><div><b>Empfohlene Routine</b><p>Auto-Sicherung aktiv lassen, monatlich ein zusätzliches Vollbackup auf einem zweiten Datenträger ablegen und regelmäßig eine PDF-Gesamtdokumentation erstellen.</p></div></div>
      <p className="manual-version">Bienen Doku · Bedienungsanleitung · Erstellt von T. Kruska · Stand August 2026</p>
    </section>
  );

  return (
    <div className={`app-shell ${printReport ? "printing-full-report" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => switchView("dashboard")} aria-label="Bienen Doku Startseite"><span className="brand-mark" aria-hidden="true" /><span><b>Bienen Doku</b><small>Pflicht sicher im Blick</small></span></button>
        <nav className="desktop-nav" aria-label="Hauptnavigation"><button className={activeView === "dashboard" ? "active" : ""} onClick={() => switchView("dashboard")}>Übersicht</button><button className={activeView === "records" ? "active" : ""} onClick={() => switchView("records")}>Einträge</button><button className={activeView === "apiaries" ? "active" : ""} onClick={() => switchView("apiaries")}>Stände & Völker</button><button className={activeView === "breeding" ? "active" : ""} onClick={() => switchView("breeding")}>Königinnenzucht</button><button className={activeView === "export" ? "active" : ""} onClick={() => switchView("export")}>Export</button><button className={activeView === "legal" ? "active" : ""} onClick={() => switchView("legal")}>Pflichten</button><button className={activeView === "help" ? "active" : ""} onClick={() => switchView("help")}>Hilfe</button></nav>
        <div className="profile"><span className={`status-dot ${online ? "" : "offline"}`} /><span>{online ? "Online · Daten lokal" : "Offline · Daten lokal"}</span><button className="help-top-button" onClick={() => switchView("help")} aria-label="Hilfe und Handbuch öffnen">?</button><span className="profile-button">{initials}</span></div>
      </header>

      <main id="top">
        {activeView === "dashboard" && Dashboard()}
        {activeView === "records" && RecordsView()}
        {activeView === "apiaries" && ApiariesView()}
        {activeView === "breeding" && BreedingView()}
        {activeView === "export" && ExportView()}
        {activeView === "legal" && LegalView()}
        {activeView === "help" && HelpView()}
      </main>

      {printReport && <FullPrintReport records={records} attachments={printAttachments} catalog={catalog} catalogDate={catalogDate} reportPeriod={reportPeriod} />}

      {quickstartOpen && <div className="modal-backdrop quickstart-backdrop" role="dialog" aria-modal="true" aria-labelledby="quickstart-title"><div className="modal quickstart-modal"><header className="quickstart-head"><span className="quickstart-mark">BD</span><div><span className="eyebrow">Willkommen bei Bienen Doku</span><h2 id="quickstart-title">In drei Schritten startklar</h2></div><button className="icon-button" onClick={() => dismissQuickstart()} aria-label="Schnellstart für dieses Mal schließen">×</button></header><p className="quickstart-copy">Ohne aktivierte Synchronisierung bleiben deine Einträge und Belege in diesem Browser. Richte deshalb zuerst die Sicherung ein.</p><div className="quickstart-steps"><article><span>01</span><div><b>App installieren</b><small>Optional über das Browsermenü zum Startbildschirm hinzufügen. Danach funktioniert die App auch offline.</small></div></article><article><span>02</span><div><b>Auto-Sicherung einrichten</b><small>Eine Sicherungsdatei außerhalb des Browsers schützt Einträge und Belege vor Datenverlust.</small></div></article><article><span>03</span><div><b>Stand und Völker anlegen</b><small>Danach lassen sich Behandlungen, Kontrollen, Ernten und weitere Nachweise eindeutig zuordnen.</small></div></article></div><div className="quickstart-local"><span>✓</span><p><b>Deine Daten bleiben geschützt.</b> Über den öffentlichen App-Link erhält niemand Zugriff. Synchronisierung funktioniert nur mit deinem persönlichen Code.</p></div><div className="quickstart-actions"><button className="button ghost" onClick={() => openQuickstartTarget("help")}>Handbuch ansehen</button><button className="button primary" onClick={() => openQuickstartTarget("export")}>Auto-Sicherung einrichten</button></div><button className="quickstart-dismiss" onClick={() => dismissQuickstart(true)}>Diesen Hinweis nicht mehr automatisch anzeigen</button></div></div>}

      <footer><span>© {new Date().getFullYear()} T. Kruska · Bienen Doku · Open Source unter MIT-Lizenz</span><nav><button onClick={() => switchView("legal")}>Rechtsgrundlagen</button><button onClick={() => switchView("export")}>Datensicherung</button><button onClick={() => switchView("help")}>Handbuch</button><span>Datenschutz: lokal, optional Ende-zu-Ende verschlüsselt synchronisiert</span></nav></footer>
      <nav className="mobile-nav" aria-label="Mobile Navigation"><button className={activeView === "dashboard" ? "active" : ""} onClick={() => switchView("dashboard")}><i>⌂</i><span>Übersicht</span></button><button className={activeView === "records" ? "active" : ""} onClick={() => switchView("records")}><i>▤</i><span>Einträge</span></button><button className="mobile-add" onClick={() => setActiveForm("chooser")} aria-label="Neuer Eintrag">＋</button><button className={activeView === "apiaries" ? "active" : ""} onClick={() => switchView("apiaries")}><i>⬡</i><span>Völker</span></button><button className={activeView === "legal" ? "active" : ""} onClick={() => switchView("legal")}><i>§</i><span>Pflichten</span></button></nav>

      <GlobalVoiceControl activeForm={activeForm} openForm={setActiveForm} goTo={switchView} onNotice={setNotice} />

      {activeForm && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Eintrag erfassen"><div className={`modal ${activeForm === "chooser" ? "chooser-modal" : ""}`}>{activeForm === "chooser" ? <div className="entry-chooser"><div className="form-heading"><div><span className="eyebrow">Neuer Datensatz</span><h2>Was möchtest du erfassen?</h2></div><button className="icon-button" onClick={() => setActiveForm(null)} aria-label="Auswahl schließen">×</button></div><div className="chooser-grid">{(Object.keys(labels) as RecordType[]).map((type) => { const item = labels[type]; return <button key={type} onClick={() => setActiveForm(type)}><span className={`quick-icon ${item.tone}`}>{item.icon}</span><span><b>{item.label}</b><small>{item.short}</small></span><i>→</i></button>; })}</div></div> : activeForm === "treatment" ? <TreatmentForm products={catalog.products} catalog={catalog} onCancel={() => setActiveForm(null)} onSaved={saved} /> : <GenericForm type={activeForm} onCancel={() => setActiveForm(null)} onSaved={saved} />}</div></div>}

      {selected && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Eintrag anzeigen"><div className="modal detail-modal"><div className="detail-head"><span className={`quick-icon ${labels[selected.type].tone}`}>{labels[selected.type].icon}</span><div><span className="eyebrow">{labels[selected.type].label} · {formatDate(selected.eventDate)}{selected.payload.voided ? " · storniert" : ""}</span><h2>{selected.title}</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Eintrag schließen">×</button></div>{selected.payload.voided && <div className="void-banner"><b>Stornierter Nachweis</b><span>Der Originaleintrag bleibt für die Aufbewahrungsfrist erhalten.</span></div>}<dl>{Object.entries(selected.payload).filter(([, value]) => value !== "" && value !== null && value !== undefined).map(([key, value]) => <div key={key}><dt>{fieldNames[key] || key}</dt><dd>{key === "voided" ? (value ? "Storniert" : "Aktiv") : String(value)}</dd></div>)}</dl><AttachmentPanel recordId={selected.id} onNotice={setNotice} onDataChanged={markDataChanged} /><div className="detail-actions">{selected.type === "treatment" ? (!selected.payload.voided && <button className="button danger" onClick={() => void voidTreatment(selected)}>Stornieren</button>) : <button className="button danger" onClick={() => void removeRecord(selected)}>Löschen</button>}<button className="button ghost" onClick={() => window.print()}>Eintrag drucken</button>{selected.type === "disease" && <button className="button primary" onClick={() => { navigator.clipboard.writeText(Object.entries(selected.payload).map(([key, value]) => `${fieldNames[key] || key}: ${String(value)}`).join("\n")); setNotice("Meldedaten wurden kopiert."); }}>Meldedaten kopieren</button>}</div></div></div>}

      {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Hinweis schließen">×</button></div>}
    </div>
  );
}
