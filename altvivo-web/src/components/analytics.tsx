"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { CONSENT_EVENT, readConsent } from "./consent";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Signed-in areas are never measured: only the public site. */
const PRIVATE = /^\/(workspace|admin|login|register|logout|reset-password|forgot-password)(\/|$)/;

function clearGaCookies() {
  const host = window.location.hostname;
  const parent = host.split(".").slice(-2).join(".");
  for (const part of document.cookie.split("; ")) {
    const name = part.split("=")[0] ?? "";
    if (name !== "_ga" && !name.startsWith("_ga_")) continue;
    for (const domain of ["", `; domain=${host}`, `; domain=.${parent}`]) {
      document.cookie = `${name}=; path=/; max-age=0${domain}`;
    }
  }
}

/**
 * Google Analytics 4. Loads nothing until the visitor allows "Analytics" in
 * the cookie banner, stops and removes its cookies when that is withdrawn,
 * and reports page views of public pages only (IP addresses are not stored
 * by GA4; advertising signals are switched off).
 */
export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const path = usePathname();
  const loaded = useRef(false);
  const allowed = useRef(false);

  useEffect(() => {
    const disableKey = `ga-disable-${measurementId}` as const;
    const flags = window as unknown as Record<string, boolean>;

    const apply = () => {
      allowed.current = readConsent()?.analytics === true;
      flags[disableKey] = !allowed.current;
      if (!allowed.current) {
        if (loaded.current) clearGaCookies();
        return;
      }
      if (loaded.current) return;
      loaded.current = true;
      window.dataLayer = window.dataLayer ?? [];
      window.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params -- gtag.js expects the arguments object
        window.dataLayer!.push(arguments);
      };
      window.gtag("js", new Date());
      // Page views are sent by the effect below, so each route counts once.
      window.gtag("config", measurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
      const s = document.createElement("script");
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      document.head.appendChild(s);
      pageView();
    };
    const pageView = () => {
      if (!allowed.current || PRIVATE.test(window.location.pathname)) return;
      window.gtag?.("event", "page_view", { page_location: window.location.origin + window.location.pathname, page_title: document.title });
    };

    apply();
    window.addEventListener(CONSENT_EVENT, apply);
    return () => window.removeEventListener(CONSENT_EVENT, apply);
  }, [measurementId]);

  // Client-side navigation.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!allowed.current || PRIVATE.test(path)) return;
    window.gtag?.("event", "page_view", { page_location: window.location.origin + path, page_title: document.title });
  }, [path]);

  return null;
}
