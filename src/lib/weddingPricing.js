// Wedding-enquiry pricing. Every amount is an integer number of euro cents;
// nothing here uses floating point, so 105.00 € × 63 guests can't drift.
//
// The same rules are implemented server-side in public/api/_lib/quote.php,
// which recalculates from the same public/api/wedding-offer.json. The
// browser's numbers are never trusted — they exist only to show the guest an
// estimate while they configure.

/** Whole, non-negative integer or 0 — form fields arrive as strings. */
export function toCount(value) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Which per-person package rate applies.
 *
 * The offer prices 105.00 € "при минимум 60 души" and 115.00 € "под 60 души"
 * but never says whether children on the children's menu count toward those
 * 60. Until the hotel confirms it (package.thresholdBasis.confirmed), the
 * one case where the two readings disagree — standard-menu guests below 60
 * but the combined count at or above it — is reported as a range rather than
 * silently resolved.
 */
export function resolveRate(offer, standardGuests, children) {
  const { thresholdGuests, atOrAboveThresholdCents, belowThresholdCents, thresholdBasis } =
    offer.package;
  const combined = standardGuests + children;

  if (standardGuests >= thresholdGuests) {
    return { kind: "single", rateCents: atOrAboveThresholdCents };
  }
  if (combined < thresholdGuests) {
    return { kind: "single", rateCents: belowThresholdCents };
  }
  // Standard-menu guests below the threshold, combined count at or above it.
  if (thresholdBasis?.confirmed) {
    return {
      kind: "single",
      rateCents:
        thresholdBasis.value === "combined_guests"
          ? atOrAboveThresholdCents
          : belowThresholdCents,
    };
  }
  return {
    kind: "range",
    minRateCents: atOrAboveThresholdCents,
    maxRateCents: belowThresholdCents,
  };
}

/** The upgrades belonging to the chosen variant, indexed by id. */
export function upgradesForMenu(offer, menuId) {
  return offer.menus.find((m) => m.id === menuId)?.upgrades || [];
}

/**
 * Turn a configuration into priced lines plus the totals.
 * Services without a published price never touch the numbers — they are
 * carried separately so the summary can list them as "по индивидуална оферта".
 */
export function buildQuote(offer, config) {
  const standardGuests = toCount(config.standardGuests);
  const children = toCount(config.children);
  const rate = resolveRate(offer, standardGuests, children);

  const lines = [];

  // Standard menus — one line, or a range line when the threshold basis is
  // unresolved for this particular guest split.
  const menuLine = {
    id: "standard-menus",
    quantity: standardGuests,
    unit: "per_person",
  };
  if (rate.kind === "single") {
    menuLine.unitPriceCents = rate.rateCents;
    menuLine.totalCents = standardGuests * rate.rateCents;
  } else {
    menuLine.minUnitPriceCents = rate.minRateCents;
    menuLine.maxUnitPriceCents = rate.maxRateCents;
    menuLine.minTotalCents = standardGuests * rate.minRateCents;
    menuLine.maxTotalCents = standardGuests * rate.maxRateCents;
  }
  if (standardGuests > 0) lines.push(menuLine);

  if (children > 0) {
    lines.push({
      id: "child-menus",
      quantity: children,
      unit: "per_child",
      unitPriceCents: offer.package.childMenuCents,
      totalCents: children * offer.package.childMenuCents,
    });
  }

  // Menu upgrades, priced per standard-menu guest. An upgrade the hotel has
  // not priced yet (priceCents null) is carried as a request instead — it is
  // never guessed at and never reaches the total.
  const upgrades = upgradesForMenu(offer, config.menus?.primary);
  const chosenUpgrades = (config.menuUpgrades || []).filter((id) =>
    upgrades.some((u) => u.id === id)
  );
  const quotedUpgrades = [];
  for (const upgrade of upgrades) {
    if (!chosenUpgrades.includes(upgrade.id)) continue;
    if (upgrade.priceCents == null) {
      quotedUpgrades.push({ id: upgrade.id, name: upgrade.name });
      continue;
    }
    lines.push({
      id: upgrade.id,
      quantity: standardGuests,
      unit: "per_person",
      unitPriceCents: upgrade.priceCents,
      totalCents: standardGuests * upgrade.priceCents,
    });
  }

  // Priced extras, in the offer's own order.
  for (const extra of offer.extras) {
    const selection = config.extras?.[extra.id];
    if (!selection?.selected) continue;

    let quantity = 1;
    if (extra.unit === "per_person") quantity = toCount(selection.covers);
    else if (extra.unit === "per_hour") quantity = toCount(selection.hours);
    if (quantity <= 0) continue;

    lines.push({
      id: extra.id,
      quantity,
      unit: extra.unit,
      unitPriceCents: extra.priceCents,
      totalCents: quantity * extra.priceCents,
    });

    // An extra can be upgraded too — the Moët glass at the welcome cocktail.
    // It follows the extra's own quantity, so it is priced per cocktail cover
    // rather than per wedding guest.
    for (const upgrade of extra.upgrades || []) {
      if (!(selection.upgrades || []).includes(upgrade.id)) continue;
      if (upgrade.priceCents == null) {
        quotedUpgrades.push({ id: upgrade.id, name: upgrade.name });
        continue;
      }
      lines.push({
        id: upgrade.id,
        label: upgrade.name,
        quantity,
        unit: extra.unit,
        unitPriceCents: upgrade.priceCents,
        totalCents: quantity * upgrade.priceCents,
      });
    }
  }

  const sum = (pick) => lines.reduce((acc, l) => acc + pick(l), 0);
  const minTotalCents = sum((l) => l.minTotalCents ?? l.totalCents ?? 0);
  const maxTotalCents = sum((l) => l.maxTotalCents ?? l.totalCents ?? 0);

  return {
    standardGuests,
    children,
    totalGuests: standardGuests + children,
    rate,
    lines,
    quotedUpgrades,
    isRange: minTotalCents !== maxTotalCents,
    minTotalCents,
    maxTotalCents,
  };
}

/** "1 234,00 €" — the site writes amounts as number + space + €. */
export function formatMoney(cents, lang = "bg") {
  const locale = lang === "en" ? "en-GB" : lang === "ro" ? "ro-RO" : "bg-BG";
  const value = (cents / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value} €`;
}

/** Whether the quoted prices are still inside the offer's own validity. */
export function offerExpired(offer, today = new Date()) {
  const deadline = new Date(`${offer.reservationDeadline}T23:59:59`);
  return today > deadline;
}
