import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bienen-doku-pflicht.kramer250.workers.dev"),
  title: "Bienen Doku",
  description: "Offene Offline-Imkerei-Dokumentation. Einträge und Belege bleiben auf dem eigenen Gerät.",
  manifest: "/manifest.webmanifest",
  applicationName: "Bienen Doku",
  appleWebApp: { capable: true, title: "Bienen Doku", statusBarStyle: "default" },
  authors: [{ name: "T. Kruska" }],
  creator: "T. Kruska",
  keywords: ["Imkerei", "Bienen", "Bestandsbuch", "Tierarzneimittel", "Honig", "Open Source"],
  openGraph: {
    title: "Bienen Doku",
    description: "Offline-Imkerei-Dokumentation mit lokaler Datenspeicherung.",
    type: "website",
    images: [{ url: "https://bienen-doku-pflicht.kramer250.workers.dev/og.png", width: 1729, height: 910, alt: "Bienen Doku – Imkerei-Dokumentation" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bienen Doku",
    description: "Offline-Imkerei-Dokumentation mit lokaler Datenspeicherung.",
    images: ["https://bienen-doku-pflicht.kramer250.workers.dev/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = { themeColor: "#275f45", width: "device-width", initialScale: 1 };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased">{children}</body>
    </html>
  );
}
