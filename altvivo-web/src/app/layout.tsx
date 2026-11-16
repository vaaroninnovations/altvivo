import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { headers } from "next/headers";
import { PUBLIC } from "@/lib/config";
import { GoogleAnalytics } from "@/components/analytics";
import { CookieConsent } from "@/components/consent";
import { seo } from "@/lib/seo";
import "./globals.css";

// Open-source fonts (SIL Open Font License): Inter for interface and body text,
// Source Serif 4 for headings, JetBrains Mono for figures and data.
const sans = Inter({ subsets: ["latin"], variable: "--font-ui-sans", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-ui-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-ui-mono", display: "swap" });

/** Read per request so the verification codes can be set without rebuilding the image. */
export function generateMetadata(): Metadata {
  const { googleSiteVerification: google, bingSiteVerification: bing } = seo();
  return {
    metadataBase: new URL(PUBLIC.siteUrl),
    title: { default: "AltVivo | The Unified Digital Infrastructure for Life Sciences, Preclinical Discovery & Scientific Education", template: "%s · AltVivo" },
    description:
      "AltVivo is a next-generation scientific cloud ecosystem. We build, host and integrate computational engines, virtual physiological laboratories, computer-vision analytics, biostatistical suites and regulatory intelligence tools for universities, research institutes, CROs and biopharma R&D worldwide.",
    openGraph: { type: "website", siteName: "AltVivo", url: PUBLIC.siteUrl },
    robots: { index: true, follow: true },
    // ---- Site-ownership tags (Google Search Console, Bing Webmaster Tools) ----
    // Paste the codes into GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION in
    // altvivo-infra/.env; they are printed in <head> as
    //   <meta name="google-site-verification" content="..."> and <meta name="msvalidate.01" content="...">
    ...(google || bing ? { verification: { ...(google ? { google } : {}), ...(bing ? { other: { "msvalidate.01": bing } } : {}) } } : {}),
  };
}

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
  const { gaMeasurementId } = seo();
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <CookieConsent />
        {/* Google Analytics 4: set GA_MEASUREMENT_ID (G-XXXXXXXXXX). Loads only after the visitor allows Analytics. */}
        {gaMeasurementId && <GoogleAnalytics measurementId={gaMeasurementId} />}
      </body>
    </html>
  );
}
