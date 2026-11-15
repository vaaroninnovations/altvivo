import type { MetadataRoute } from "next";
import { PUBLIC } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${PUBLIC.siteUrl}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${PUBLIC.siteUrl}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${PUBLIC.siteUrl}/advisory-board`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${PUBLIC.siteUrl}/contact`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${PUBLIC.siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${PUBLIC.siteUrl}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${PUBLIC.siteUrl}/cookies`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
