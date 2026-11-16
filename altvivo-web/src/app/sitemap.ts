import type { MetadataRoute } from "next";
import { PUBLIC } from "@/lib/config";

/** Served as /sitemap.xml: every public page. Add a row when a public page is added. */
const PAGES: [path: string, changeFrequency: "weekly" | "monthly" | "yearly", priority: number][] = [
  ["/", "weekly", 1],
  ["/free-month", "monthly", 0.9],
  ["/pricing", "monthly", 0.9],
  ["/about", "monthly", 0.8],
  ["/docs", "monthly", 0.8],
  ["/contact", "yearly", 0.5],
  ["/privacy", "yearly", 0.3],
  ["/terms", "yearly", 0.3],
  ["/cookies", "yearly", 0.3],
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PAGES.map(([path, changeFrequency, priority]) => ({ url: `${PUBLIC.siteUrl}${path}`, lastModified, changeFrequency, priority }));
}
