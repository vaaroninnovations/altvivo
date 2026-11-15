"use client";

import { Cookie } from "lucide-react";
import { openCookiePreferences } from "./consent";
import { Button } from "./ui";

export function CookieSettingsButton() {
  return (
    <Button variant="outline" onClick={openCookiePreferences}>
      <Cookie className="size-4" aria-hidden /> Change cookie preferences
    </Button>
  );
}
