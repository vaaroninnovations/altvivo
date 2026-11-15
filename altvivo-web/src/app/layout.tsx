import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import { headers } from "next/headers";
import { PUBLIC } from "@/lib/config";
import { CookieConsent } from "@/components/consent";
import "./globals.css";

// IBM Plex superfamily (SIL Open Font License): one designed system for interface, display and data.
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const serif = IBM_Plex_Serif({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-plex-serif", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC.siteUrl),
  title: { default: "AltVivo | The Unified Digital Infrastructure for Life Sciences, Preclinical Discovery & Scientific Education", template: "%s · AltVivo" },
  description:
    "AltVivo is a next-generation scientific cloud ecosystem. We build, host and integrate computational engines, virtual physiological laboratories, computer-vision analytics, biostatistical suites and regulatory intelligence tools for universities, research institutes, CROs and biopharma R&D worldwide.",
  openGraph: { type: "website", siteName: "AltVivo", url: PUBLIC.siteUrl },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F6" },
    { media: "(prefers-color-scheme: dark)", color: "#09081A" },
  ],
};

// Applies the saved theme before first paint (no flash). Nonce'd for the CSP.
const THEME_SCRIPT = `try{var p=localStorage.getItem("altvivo-theme")||sessionStorage.getItem("altvivo-theme")||"system";if(p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
