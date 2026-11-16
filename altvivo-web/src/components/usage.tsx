"use client";

import { useState } from "react";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { formatMoney, gstEstimate } from "@/lib/money";
import type { CatalogPlan, PayPerUse, PublicApp } from "@/lib/types";
import { CheckoutDialog, type Viewer } from "./checkout";
import { Dialog } from "./client";
import { Button, cx } from "./ui";

const PRESETS = [5, 10, 25, 50];
const MAX = 5000;

/**
 * Pay per use: choose how many analyses (one animal / video each) to buy, then
 * the normal checkout (billing details -> GST total -> Razorpay). Paid analyses
 * are added to the account at once.
 */
export function BuyAnalysesDialog({
  open,
  onClose,
  offer,
  app,
  viewer,
  returnPath,
  onActivated,
}: {
  open: boolean;
  onClose: () => void;
  onActivated?: () => void;
  offer: PayPerUse;
  app: Pick<PublicApp, "appId" | "name" | "url">;
  viewer: Viewer;
  returnPath: string;
}) {
  const [quantity, setQuantity] = useState(10);
  const [checkout, setCheckout] = useState(false);
  const valid = Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX;
  const quote = gstEstimate(offer.amountMinor * (valid ? quantity : 0), offer.gstRateBp, "INR");
  const unit = formatMoney(offer.amountMinor, "INR", { whole: true });

  if (checkout) {
    // The checkout dialog prices "quantity x unit price", exactly as the server will.
    const asPlan: CatalogPlan = {
      planCode: `payg_${app.appId}`,
      name: `${app.name} pay per use`,
      description: "",
      kind: "SINGLE_APP",
      pricingModel: "PER_SEAT",
      interval: "YEAR",
      minSeats: 1,
      maxSeats: MAX,
      apps: [app.appId],
      features: [],
      highlighted: false,
      gstRateBp: offer.gstRateBp,
      amountMinor: offer.amountMinor,
      prices: { INR: offer.amountMinor, USD: offer.amountMinor },
      renews: "prepaid",
      purchasable: offer.purchasable,
      quoteAvailable: false,
    };
    return (
      <CheckoutDialog
        open
        onClose={() => {
          setCheckout(false);
          onClose();
        }}
        plan={asPlan}
        seats={quantity}
        usage={{ appId: app.appId, quantity }}
        viewer={viewer}
        apps={[app]}
        returnPath={returnPath}
        onActivated={onActivated}
      />
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title={`${app.name} pay per use`}>
      <p className="text-sm text-muted">
        {unit} plus GST for each animal or video that is tracked and analysed. Buy as many as you need now; unused ones stay on your account.
      </p>
      <p className="mt-5 text-sm font-medium" id="payg-q">
        How many analyses?
      </p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="payg-q">
        {PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setQuantity(n)}
            aria-pressed={quantity === n}
            className={cx("readout rounded-xl border px-4 py-2 text-sm transition", quantity === n ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line hover:border-line-strong")}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" aria-label="One fewer" className="grid size-10 place-items-center rounded-xl border border-line-strong hover:border-accent" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
          <Minus className="size-4" aria-hidden />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX}
          value={quantity || ""}
          onChange={(e) => setQuantity(Math.min(MAX, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
          className="field readout w-28 text-center text-lg"
          aria-label="Number of analyses"
          aria-invalid={!valid}
        />
        <button type="button" aria-label="One more" className="grid size-10 place-items-center rounded-xl border border-line-strong hover:border-accent" onClick={() => setQuantity((q) => Math.min(MAX, q + 1))}>
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      <dl className="mt-5 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">
            {valid ? quantity : 0} × {unit}
          </dt>
          <dd className="readout">{formatMoney(quote.taxableMinor, "INR")}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">GST {offer.gstRateBp / 100}%</dt>
          <dd className="readout">{formatMoney(quote.taxMinor, "INR")}</dd>
        </div>
        <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
          <dt>Total</dt>
          <dd className="readout">{formatMoney(quote.totalMinor, "INR")}</dd>
        </div>
      </dl>
      <Button className="mt-6 w-full" size="lg" disabled={!valid || !offer.purchasable} onClick={() => setCheckout(true)}>
        {offer.purchasable ? (
          <>
            Continue to payment <ArrowRight className="size-4" aria-hidden />
          </>
        ) : (
          "Online purchase opening soon"
        )}
      </Button>
      {!offer.purchasable && (
        <p className="mt-3 text-center text-xs text-subtle">
          Until then, write to <a href="/contact?topic=sales" className="underline">our team</a> and we will set it up for you.
        </p>
      )}
    </Dialog>
  );
}
