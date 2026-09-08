import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { StepHeading, NumberField, TextArea, CheckBox, Notice } from "./fields.jsx";
import { fill } from "../../i18n/weddingConfigurator.js";

function MenuCard({ menu, offer, s, selected, onSelect, mixed, quantity, onQuantity }) {
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
          {selected && !mixed && (
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
        {mixed ? (
          <NumberField
            label={s.summary.guests}
            value={quantity}
            min={0}
            onChange={onQuantity}
          />
        ) : (
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
        )}
      </div>
    </article>
  );
}

/** Step 2 — the four standard menus, plus children's menus when relevant. */
export default function StepMenus({ s, offer, config, update, errors }) {
  const { menus, childMenus } = config;
  const standard = Number.parseInt(config.guests.standard, 10) || 0;
  const children = Number.parseInt(config.guests.children, 10) || 0;

  const allocated = Object.values(menus.allocation).reduce(
    (sum, n) => sum + (Number.parseInt(n, 10) || 0),
    0
  );
  const childAllocated = Object.values(childMenus).reduce(
    (sum, n) => sum + (Number.parseInt(n, 10) || 0),
    0
  );

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
              mixed={menus.mixed}
              selected={menus.primary === menu.id}
              quantity={menus.allocation[menu.id] ?? ""}
              onSelect={() => update("menus", { ...menus, primary: menu.id })}
              onQuantity={(v) =>
                update("menus", {
                  ...menus,
                  allocation: { ...menus.allocation, [menu.id]: v },
                })
              }
            />
          ))}
        </div>

        {errors.primaryMenu && (
          <p role="alert" className="text-xs text-red-300/90 mt-4">
            {errors.primaryMenu}
          </p>
        )}

        <div className="mt-6 space-y-4">
          <CheckBox
            checked={menus.mixed}
            onChange={(checked) =>
              update("menus", {
                ...menus,
                mixed: checked,
                allocation: checked ? menus.allocation : {},
              })
            }
          >
            {s.menus.mixedToggle}
          </CheckBox>

          {menus.mixed && (
            <>
              <Notice tone="warn">{s.menus.mixedHint}</Notice>
              <div className="flex items-center justify-between border border-gold-300/15 bg-ink-900/60 px-4 py-3">
                <span className="text-xs tracking-[0.2em] uppercase text-gold-300/70">
                  {s.menus.mixedSumLabel}
                </span>
                <span
                  className={`font-display text-xl ${
                    allocated === standard ? "text-cream-50" : "text-red-300"
                  }`}
                >
                  {allocated} / {standard}
                </span>
              </div>
              {errors.menuAllocation && (
                <p role="alert" className="text-xs text-red-300/90">
                  {errors.menuAllocation}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* Children's menus appear only once children have been counted, and the
          allocation is cleared when that count returns to zero. */}
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
                  <NumberField
                    label={s.summary.childMenu}
                    value={childMenus[menu.id] ?? ""}
                    min={0}
                    onChange={(v) => update("childMenus", { ...childMenus, [menu.id]: v })}
                  />
                </div>
              </article>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between border border-gold-300/15 bg-ink-900/60 px-4 py-3">
            <span className="text-xs tracking-[0.2em] uppercase text-gold-300/70">
              {s.menus.mixedSumLabel}
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
