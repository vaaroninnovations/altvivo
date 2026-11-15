import type { MetadataRoute } from "next";
import { PUBLIC } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/pricing"], disallow: ["/workspace", "/login", "/register", "/logout", "/reset-password", "/coming-soon"] }],
    sitemap: `${PUBLIC.siteUrl}/sitemap.xml`,
  };
}
