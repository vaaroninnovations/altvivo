import type { MetadataRoute } from "next";
import { PUBLIC } from "@/lib/config";

/** Served as /robots.txt. Public pages are open; signed-in and one-off pages are kept out of search results. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/workspace", "/admin", "/api/", "/login", "/register", "/logout", "/forgot-password", "/reset-password", "/coming-soon"],
      },
    ],
    sitemap: `${PUBLIC.siteUrl}/sitemap.xml`,
    host: PUBLIC.siteUrl,
  };
}
