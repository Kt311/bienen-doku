export type VarroaProduct = {
  name: string;
  activeIngredient: string;
  availability: string;
  colonyState: "Volk mit Brut" | "Volk ohne Brut";
  note?: string;
};

export type ApplicationCourse = "single" | "repeat" | "insert-remove" | "device";

export type VarroaApplicationProfile = {
  dosageForm: string;
  amountLabel: string;
  units: string[];
  methods: string[];
  course: ApplicationCourse;
  courseHint: string;
  eventDatesLabel?: string;
  deviceLabel?: string;
};

export type TreatmentMethod = {
  id: string;
  title: string;
  category: string;
  guidance: string;
};

export type ComplianceCatalog = {
  version: string;
  verifiedAt: string;
  nextReviewDue: string;
  reviewIntervalDays: number;
  productListDate: string;
  jurisdiction: "DE";
  notice: string;
  products: VarroaProduct[];
  methods: TreatmentMethod[];
  sources: Array<{ title: string; url: string }>;
};

// Amtliche LWG-Übersicht „Zugelassene Varroamittel“, Stand Juni 2025.
// Zulassungsstatus und Packungsbeilage müssen vor jeder Anwendung erneut geprüft werden.
export const VARROA_PRODUCTS: VarroaProduct[] = [
  { name: "Ameisensäure 60% ad us. vet.", activeIngredient: "Ameisensäure", availability: "freiverkäuflich", colonyState: "Volk mit Brut", note: "Vertriebsdauer laut LWG bis maximal 2027." },
  { name: "Ameisensäure 60 Bernburg", activeIngredient: "Ameisensäure", availability: "freiverkäuflich", colonyState: "Volk mit Brut", note: "Nachfolgepräparat für Ameisensäure 60%." },
  { name: "Formivar 60% ad us. vet.", activeIngredient: "Ameisensäure", availability: "freiverkäuflich", colonyState: "Volk mit Brut", note: "Vertriebsdauer laut LWG bis maximal 2027." },
  { name: "Formic Pro", activeIngredient: "Ameisensäure", availability: "freiverkäuflich", colonyState: "Volk mit Brut", note: "Nachfolgeartikel für MAQS seit 2022." },
  { name: "Apiguard", activeIngredient: "Thymol", availability: "freiverkäuflich", colonyState: "Volk mit Brut" },
  { name: "Thymovar", activeIngredient: "Thymol", availability: "freiverkäuflich", colonyState: "Volk mit Brut" },
  { name: "ApiLifeVar", activeIngredient: "Thymol u. a.", availability: "freiverkäuflich", colonyState: "Volk mit Brut" },
  { name: "VarroMed", activeIngredient: "Oxalsäure und Ameisensäure", availability: "freiverkäuflich", colonyState: "Volk mit Brut" },
  { name: "PolyVar Yellow", activeIngredient: "Flumethrin", availability: "frei in der Apotheke", colonyState: "Volk mit Brut" },
  { name: "Bayvarol", activeIngredient: "Flumethrin", availability: "frei in der Apotheke", colonyState: "Volk mit Brut" },
  { name: "Apitraz", activeIngredient: "Amitraz", availability: "rezeptpflichtig", colonyState: "Volk mit Brut" },
  { name: "ApiVar", activeIngredient: "Amitraz", availability: "rezeptpflichtig", colonyState: "Volk mit Brut" },
  { name: "Milchsäure 15% ad us. vet.", activeIngredient: "Milchsäure", availability: "freiverkäuflich", colonyState: "Volk ohne Brut", note: "Vertriebsdauer laut LWG bis maximal 2027." },
  { name: "Milchsäure 150 Bernburg", activeIngredient: "Milchsäure", availability: "freiverkäuflich", colonyState: "Volk ohne Brut", note: "Nachfolgepräparat für Milchsäure 15%." },
  { name: "Oxalsäuredihydrat-Lösung 3,5% (m/V) ad us. vet.", activeIngredient: "Oxalsäure", availability: "freiverkäuflich", colonyState: "Volk ohne Brut", note: "Vertriebsdauer laut LWG bis maximal 2027." },
  { name: "Oxalsäure Bernburg 40 mg/ml", activeIngredient: "Oxalsäure", availability: "freiverkäuflich", colonyState: "Volk ohne Brut", note: "Nachfolgepräparat für Oxalsäuredihydrat-Lösung 3,5%." },
  { name: "Oxuvar ad us. vet.", activeIngredient: "Oxalsäure", availability: "freiverkäuflich", colonyState: "Volk ohne Brut", note: "Vertriebsdauer laut LWG bis maximal 2027." },
  { name: "Oxuvar 5,7% ad us. vet.", activeIngredient: "Oxalsäure", availability: "freiverkäuflich", colonyState: "Volk ohne Brut" },
  { name: "OxyBee / Bienenwohl", activeIngredient: "Oxalsäure", availability: "freiverkäuflich", colonyState: "Volk ohne Brut" },
  { name: "Varroxal 0,71 g/g Bienenstock-Pulver", activeIngredient: "Oxalsäure", availability: "freiverkäuflich", colonyState: "Volk ohne Brut", note: "Sublimation nur mit Varrox Eddy oder Varrox Verdampfer; außerdem nach Packungsbeilage zum Träufeln und Sprühen." },
  { name: "Calistrip Biox 6,44 g imprägnierter Streifen", activeIngredient: "Oxalsäure", availability: "freiverkäuflich", colonyState: "Volk ohne Brut" },
];

const FORMIC_LIQUID: VarroaApplicationProfile = {
  dosageForm: "Flüssigkeit zur Anwendung im Bienenstock",
  amountLabel: "Eingesetzte Präparatmenge",
  units: ["ml"],
  methods: ["Verdunstung mit zugelassener Applikationshilfe"],
  course: "device",
  deviceLabel: "Verwendete Applikationshilfe / Verdunster",
  courseHint: "Präparatmenge, Applikationshilfe und tatsächlichen Behandlungszeitraum dokumentieren. Temperaturgrenzen und Anwendung ausschließlich der Packungsbeilage entnehmen.",
};

const STRIP_INSERT: VarroaApplicationProfile = {
  dosageForm: "Streifen für den Bienenstock",
  amountLabel: "Eingesetzte Streifen je Anwendung",
  units: ["Streifen"],
  methods: ["Streifen in den Bienenstock einhängen"],
  course: "insert-remove",
  courseHint: "Einlege- und tatsächliches Entnahmedatum sowie die Streifenanzahl dokumentieren.",
};

const OXALIC_LIQUID: VarroaApplicationProfile = {
  dosageForm: "Oxalsäure-Lösung für den Bienenstock",
  amountLabel: "Verabreichte Lösungsmenge",
  units: ["ml"],
  methods: ["Träufeln", "Sprühen – nur wenn für das Präparat zugelassen"],
  course: "single",
  courseHint: "Nur die in der aktuellen Packungsbeilage des ausgewählten Präparats zugelassene Anwendungsart wählen.",
};

export const VARROA_APPLICATION_PROFILES: Record<string, VarroaApplicationProfile> = {
  "Ameisensäure 60% ad us. vet.": FORMIC_LIQUID,
  "Ameisensäure 60 Bernburg": FORMIC_LIQUID,
  "Formivar 60% ad us. vet.": FORMIC_LIQUID,
  "Formic Pro": {
    dosageForm: "Ameisensäure-Streifen für den Bienenstock",
    amountLabel: "Eingesetzte Streifen je Anwendung",
    units: ["Streifen"],
    methods: ["Streifen auflegen"],
    course: "insert-remove",
    courseHint: "Streifenanzahl sowie Einlege- und tatsächliches Entnahmedatum dokumentieren.",
  },
  Apiguard: {
    dosageForm: "Gel zur Anwendung im Bienenstock",
    amountLabel: "Eingesetzte Menge je Anwendung",
    units: ["Schalen", "g"],
    methods: ["Gelschale auflegen", "Gel auf Dosierhilfe aufbringen"],
    course: "repeat",
    eventDatesLabel: "Datum/Daten der erneuten Anwendung bzw. des Schalenwechsels",
    courseHint: "Jede Anwendung beziehungsweise jeden Schalenwechsel mit Datum dokumentieren.",
  },
  Thymovar: {
    dosageForm: "Thymol-Streifen für den Bienenstock",
    amountLabel: "Eingesetzte Streifen je Anwendung",
    units: ["Streifen"],
    methods: ["Streifen auflegen"],
    course: "repeat",
    eventDatesLabel: "Wechsel-/Wiederholungsdaten",
    courseHint: "Streifenanzahl und jeden Wechsel beziehungsweise jede weitere Anwendung mit Datum dokumentieren.",
  },
  ApiLifeVar: {
    dosageForm: "Streifen für den Bienenstock",
    amountLabel: "Eingesetzte Streifen je Anwendung",
    units: ["Streifen"],
    methods: ["Streifen auflegen"],
    course: "repeat",
    eventDatesLabel: "Wechsel-/Wiederholungsdaten der Streifen",
    courseHint: "Api Life Var wird als Streifen dokumentiert. Jeden Austausch beziehungsweise jede erneute Anwendung mit Datum erfassen – keine ml-Menge eintragen.",
  },
  VarroMed: {
    dosageForm: "Lösung zur Anwendung im Bienenstock",
    amountLabel: "Verabreichte Lösungsmenge je Anwendung",
    units: ["ml"],
    methods: ["Träufeln auf die Bienen in den Wabengassen"],
    course: "repeat",
    eventDatesLabel: "Daten weiterer Anwendungen",
    courseHint: "Bei mehreren Anwendungen jede einzelne Gabe mit Datum dokumentieren.",
  },
  "PolyVar Yellow": {
    dosageForm: "Wirkstoffhaltiger Fluglochstreifen",
    amountLabel: "Eingesetzte Fluglochstreifen",
    units: ["Streifen"],
    methods: ["Fluglochstreifen einsetzen"],
    course: "insert-remove",
    courseHint: "Anzahl der Fluglochstreifen sowie Einsetz- und tatsächliches Entnahmedatum dokumentieren.",
  },
  Bayvarol: STRIP_INSERT,
  Apitraz: STRIP_INSERT,
  ApiVar: STRIP_INSERT,
  "Milchsäure 15% ad us. vet.": {
    dosageForm: "Sprühlösung für Honigbienen",
    amountLabel: "Versprühte Lösungsmenge",
    units: ["ml"],
    methods: ["Sprühen auf die Bienen"],
    course: "single",
    courseHint: "Tatsächlich versprühte Menge und behandelte Völker dokumentieren.",
  },
  "Milchsäure 150 Bernburg": {
    dosageForm: "Sprühlösung für Honigbienen",
    amountLabel: "Versprühte Lösungsmenge",
    units: ["ml"],
    methods: ["Sprühen auf die Bienen"],
    course: "single",
    courseHint: "Tatsächlich versprühte Menge und behandelte Völker dokumentieren.",
  },
  "Oxalsäuredihydrat-Lösung 3,5% (m/V) ad us. vet.": OXALIC_LIQUID,
  "Oxalsäure Bernburg 40 mg/ml": OXALIC_LIQUID,
  "Oxuvar ad us. vet.": OXALIC_LIQUID,
  "Oxuvar 5,7% ad us. vet.": OXALIC_LIQUID,
  "OxyBee / Bienenwohl": {
    dosageForm: "Oxalsäure-Lösung zum Träufeln",
    amountLabel: "Verabreichte Lösungsmenge",
    units: ["ml"],
    methods: ["Träufeln auf die Bienen in den Wabengassen"],
    course: "single",
    courseHint: "Tatsächlich verabreichte Lösungsmenge dokumentieren.",
  },
  "Varroxal 0,71 g/g Bienenstock-Pulver": {
    dosageForm: "Pulver für den Bienenstock",
    amountLabel: "Eingesetzte Präparatmenge",
    units: ["g"],
    methods: ["Sublimation mit zugelassenem Gerät", "Träufeln nach Zubereitung", "Sprühen nach Zubereitung"],
    course: "device",
    deviceLabel: "Gerät beziehungsweise Art der Zubereitung",
    courseHint: "Anwendungsweg und eingesetzte Pulvermenge dokumentieren. Für die Sublimation nur die laut Packungsbeilage zugelassenen Geräte verwenden.",
  },
  "Calistrip Biox 6,44 g imprägnierter Streifen": {
    dosageForm: "Imprägnierter Streifen für den Bienenstock",
    amountLabel: "Eingesetzte Streifen je Anwendung",
    units: ["Streifen"],
    methods: ["Streifen in den Bienenstock einhängen"],
    course: "insert-remove",
    courseHint: "Streifenanzahl sowie Einlege- und tatsächliches Entnahmedatum dokumentieren.",
  },
};

const GENERIC_APPLICATION_PROFILE: VarroaApplicationProfile = {
  dosageForm: "Tierarzneimittel für Honigbienen",
  amountLabel: "Verabreichte Präparatmenge",
  units: ["ml", "g", "Streifen", "Schalen", "Sonstige"],
  methods: ["Gemäß aktueller Packungsbeilage"],
  course: "single",
  courseHint: "Anwendungsart, Menge und Zeitraum exakt nach der aktuellen Packungsbeilage dokumentieren.",
};

export function getVarroaApplicationProfile(product: VarroaProduct | undefined) {
  return product ? VARROA_APPLICATION_PROFILES[product.name] ?? GENERIC_APPLICATION_PROFILE : GENERIC_APPLICATION_PROFILE;
}

export const VARROA_SOURCE_URL =
  "https://www.lwg.bayern.de/mam/cms06/bienen/dateien/varroabehandlungsmittel_mit_zulassung.pdf";
export const UPD_URL = "https://medicines.health.europa.eu/veterinary/de";

export const DEFAULT_COMPLIANCE_CATALOG: ComplianceCatalog = {
  version: "de-2026-09-27.1",
  verifiedAt: "2026-09-27",
  nextReviewDue: "2026-10-27",
  reviewIntervalDays: 30,
  productListDate: "2025-06",
  jurisdiction: "DE",
  notice: "Verbindlich sind die am Behandlungstag aktuelle Zulassung, Packungsbeilage und behördliche Vorgaben. Der Offline-Katalog kann gegenüber neuen oder ausgelaufenen Zulassungen zurückliegen und gibt keine Dosierung vor.",
  products: VARROA_PRODUCTS,
  methods: [
    {
      id: "monitoring",
      title: "Befalls- und Erfolgskontrolle",
      category: "Kontrolle",
      guidance: "Milbenbefall vor einer Behandlung ermitteln und den Behandlungserfolg anschließend kontrollieren; Methode und Ergebnis dokumentieren.",
    },
    {
      id: "brood-interruption",
      title: "Biotechnische Brutunterbrechung",
      category: "Biotechnisch",
      guidance: "Brutentnahme oder Käfigen der Königin nur fachgerecht und an die örtliche Situation angepasst durchführen; eine anschließende Arzneimittelanwendung separat dokumentieren.",
    },
    {
      id: "brood-present",
      title: "Behandlung im brütenden Volk",
      category: "Arzneimittel",
      guidance: "Nur ein aktuell zugelassenes und für die Situation geeignetes Präparat exakt nach Packungsbeilage anwenden.",
    },
    {
      id: "brood-free",
      title: "Restentmilbung im brutfreien Volk",
      category: "Arzneimittel",
      guidance: "Brutfreiheit prüfen und nur eine aktuell zugelassene Anwendungsart nach Packungsbeilage verwenden.",
    },
  ],
  sources: [
    { title: "LWG Bayern · Zugelassene Varroamittel", url: VARROA_SOURCE_URL },
    { title: "EU-Tierarzneimittel-Datenbank", url: UPD_URL },
    { title: "LAVES · Rechtsnormen für Tierarzneimittel in der Imkerei", url: "https://www.laves.niedersachsen.de/startseite/tiere/bienenkunde/informationsmaterial/neue-rechtsnormen-fur-tierarzneimittel-gelten-auch-fur-die-imkerei-208089.html" },
    { title: "LAVES · Winterliche Restentmilbung", url: "https://www.laves.niedersachsen.de/startseite/tiere/bienenkunde/informationsmaterial/winterliche-restentmilbung-steht-bevor-246641.html" },
    { title: "Bundesrecht · Tierseuchenmeldeverordnung", url: "https://www.gesetze-im-internet.de/tierseuchmeldv/BJNR03D0B0026.html" },
    { title: "LAVES · Varroose-Meldepflicht seit März 2026", url: "https://www.laves.niedersachsen.de/startseite/tiere/bienenkunde/informationsmaterial/die-tierseuchenmeldeverordnung-eine-gesetzliche-neuregelung-die-auch-die-imkerei-insgesamt-betrifft-251779.html" },
  ],
};
