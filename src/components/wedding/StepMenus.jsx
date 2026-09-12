import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { StepHeading, SliderNumberField, TextArea } from "./fields.jsx";
import { formatMoney } from "../../lib/weddingPricing.js";
import { fill } from "../../i18n/weddingConfigurator.js";

function MenuCard({ menu, offer, s, lang, selected, onSelect, chosenUpgrades, onToggleUpgrade }) {
  const [open, setOpen] = useState(false);

  return (
    <article
      className={`border transition-all duration-500 ${
        selected
          ? "border-gold-300/60 bg-ink-900"
          : "border-gold-300/15 bg-ink-900/50 hover:border-gold-300/35"
      }`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-display text-2xl text-cream-50">{menu.name}</h3>
          {selected && (
            <span className="flex items-center gap-1.5 text-[11px] tracking-[0.2em] uppercase text-gold-300">
              <Check className="w-3.5 h-3.5" />
              {s.menus.selected}
            </span>
          )}
        </div>

        <ul className="mt-4 space-y-3">
          {menu.courses.map((course, i) => (
            <li key={i}>
              <div className="text-sm text-cream-50">{course.title}</div>
              <div className="text-xs text-cream-100/60 leading-relaxed mt-1">{course.text}</div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="mt-4 flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-gold-300/80 hover:text-gold-200 transition-colors"
        >
          {open ? s.menus.hide : s.menus.details}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="mt-4 pt-4 border-t border-gold-300/10 space-y-4">
            <div>
              <div className="text-[11px] tracking-[0.2em] uppercase text-gold-300/70 mb-2">
                {s.menus.sharedTitle}
              </div>
              <ul className="space-y-2">
                {offer.menuShared.map((item, i) => (
                  <li key={i}>
                    <div className="text-sm text-cream-50">{item.title}</div>
                    <div className="text-xs text-cream-100/60 leading-relaxed">{item.text}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] tracking-[0.2em] uppercase text-gold-300/70 mb-2">
                {s.menus.servedWithTitle}
              </div>
              <ul className="space-y-1">
                {offer.menuServedWith.map((item, i) => (
                  <li key={i} className="text-xs text-cream-100/70">
                    · {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 pb-5">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className={`w-full px-6 py-3 text-xs tracking-[0.3em] uppercase rounded-sm transition ${
            selected ? "btn-gold" : "btn-ghost"
          }`}
        >
          {selected ? s.menus.selected : s.menus.select}
        </button>

        {/* Upgrades belong to this variant, so they live in its card and
            appear once it is chosen — an upgrade to a menu nobody picked is
            just noise in the grid. */}
        {selected && menu.upgrades?.length > 0 && (
          <div className="mt-5 pt-5 border-t border-gold-300/10">
            <div className="text-[11px] tracking-[0.2em] uppercase text-gold-300/70">
              {s.menus.upgradesTitle}
            </div>
            <p className="text-[11px] text-cream-100/45 leading-relaxed mt-1 mb-3">
              {s.menus.upgradesHint}
            </p>
            <ul className="space-y-2">
              {menu.upgrades.map((upgrade) => {
                const chosen = chosenUpgrades.includes(upgrade.id);
                return (
                  <li key={upgrade.id}>
                    <button
                      type="button"
                      onClick={() => onToggleUpgrade(upgrade.id)}
                      aria-pressed={chosen}
                      className={`w-full text-left border px-3 py-2.5 flex items-start gap-3 transition ${
                        chosen
                          ? "border-gold-300/50 bg-gold-300/[0.07]"
                          : "border-gold-300/15 hover:border-gold-300/35"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 w-4 h-4 flex-shrink-0 flex items-center justify-center border transition ${
                          chosen
                            ? "bg-gold-300/90 border-gold-300 text-ink-950"
                            : "border-gold-300/40 text-transparent"
                        }`}
                      >
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-sm text-cream-50">{upgrade.name}</span>
                          <span className="text-[10px] tracking-[0.15em] uppercase text-gold-300/70">
                            {upgrade.priceCents == null
                              ? s.menus.upgradeOnRequest
                              : `${formatMoney(upgrade.priceCents, lang)} ${s.menus.upgradePerGuest}`}
                          </span>
                        </span>
                        <span className="block text-[11px] text-cream-100/55 leading-relaxed mt-1">
                          {upgrade.text}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Step 2 — the standard menu, what the package already includes, and the
 * children's menus when there are children.
 */
export default function StepMenus({ s, offer, lang, config, update, errors }) {
  const { menus, childMenus } = config;
  const children = Number.parseInt(config.guests.children, 10) || 0;
  const included = offer.inclusions.filter((item) => item.asOption);
  const chosenUpgrades = config.menuUpgrades || [];

  const childAllocated = Object.values(childMenus).reduce(
    (sum, n) => sum + (Number.parseInt(n, 10) || 0),
    0
  );

  /**
   * There are only so many children. Raising one variant takes from the
   * others rather than letting the allocation climb past the number of
   * children actually coming.
   */
  const setChildMenu = (id, raw) => {
    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed)) {
      update("childMenus", { ...childMenus, [id]: raw });
      return;
    }
    const value = Math.max(0, Math.min(parsed, children));
    const next = { ...childMenus, [id]: String(value) };
    let room = children - value;
    for (const other of offer.childMenus) {
      if (other.id === id) continue;
      const keep = Math.min(Number.parseInt(next[other.id], 10) || 0, room);
      room -= keep;
      next[other.id] = String(keep);
    }
    update("childMenus", next);
  };

  return (
    <div className="space-y-10">
      <section>
        <StepHeading hint={s.menus.lead}>{s.menus.legend}</StepHeading>
        <p className="text-xs text-cream-100/50 mb-6 leading-relaxed">{offer.menuCourseNote}</p>

        <div className="grid md:grid-cols-2 gap-5">
          {offer.menus.map((menu) => (
            <MenuCard
              key={menu.id}
              menu={menu}
              offer={offer}
              s={s}
              lang={lang}
              selected={menus.primary === menu.id}
              onSelect={() => update("menus", { ...menus, primary: menu.id })}
              chosenUpgrades={chosenUpgrades}
              onToggleUpgrade={(id) =>
                update(
                  "menuUpgrades",
                  chosenUpgrades.includes(id)
                    ? chosenUpgrades.filter((u) => u !== id)
                    : [...chosenUpgrades, id]
                )
              }
            />
          ))}
        </div>

        {errors.primaryMenu && (
          <p role="alert" className="text-xs text-red-300/90 mt-4">
            {errors.primaryMenu}
          </p>
        )}
      </section>

      {/* What the package already covers, priced at 0.00 € and ticked: these
          come with the per-person rate, so they are shown rather than offered
          — nothing here can be added or taken away. */}
      <section>
        <StepHeading hint={s.included.note}>{s.included.title}</StepHeading>
        <ul className="grid sm:grid-cols-2 gap-3">
          {included.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 border border-gold-300/20 bg-ink-900/50 px-4 py-3"
            >
              <span
                aria-hidden="true"
                className="w-4 h-4 flex-shrink-0 flex items-center justify-center bg-gold-300/90 text-ink-950"
              >
                <Check className="w-3 h-3" strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-cream-100/85 leading-relaxed">
                  {item.label}
                </span>
                <span className="block mt-1 text-[11px] tracking-[0.15em] uppercase text-gold-300/70">
                  {s.included.badge} · {formatMoney(0, lang)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {children > 0 && (
        <section>
          <StepHeading hint={fill(s.menus.childLead, { n: children })}>
            {s.menus.childTitle}
          </StepHeading>

          <div className="grid md:grid-cols-2 gap-5">
            {offer.childMenus.map((menu) => (
              <article
                key={menu.id}
                className="border border-gold-300/15 bg-ink-900/50 p-5 flex flex-col"
              >
                <h3 className="font-display text-xl text-cream-50">{menu.name}</h3>
                <p className="text-xs text-cream-100/60 leading-relaxed mt-2">{menu.text}</p>
                <p className="text-xs text-cream-100/45 mt-2">{menu.drinks}</p>
                <div className="mt-auto pt-5">
                  <SliderNumberField
                    label={s.summary.childMenu}
                    value={childMenus[menu.id] ?? ""}
                    min={0}
                    max={children}
                    onChange={(v) => setChildMenu(menu.id, v)}
                  />
                </div>
              </article>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between border border-gold-300/15 bg-ink-900/60 px-4 py-3">
            <span className="text-xs tracking-[0.2em] uppercase text-gold-300/70">
              {s.menus.allocated}
            </span>
            <span
              className={`font-display text-xl ${
                childAllocated === children ? "text-cream-50" : "text-red-300"
              }`}
            >
              {childAllocated} / {children}
            </span>
          </div>
          {errors.childMenus && (
            <p role="alert" className="text-xs text-red-300/90 mt-3">
              {errors.childMenus}
            </p>
          )}
        </section>
      )}

      <section>
        <TextArea
          label={s.menus.dietaryLabel}
          hint={s.menus.dietaryHint}
          value={config.dietary}
          onChange={(v) => update("dietary", v)}
        />
      </section>
    </div>
  );
}
