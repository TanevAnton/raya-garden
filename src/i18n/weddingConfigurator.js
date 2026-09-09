// UI strings for the wedding-enquiry configurator (/svatben-konfigurator).
//
// Kept beside the feature rather than inside src/translations.js: the string
// set is large and changes with the offer, while translations.js holds the
// site-wide chrome. It is consumed with the same `lang` the rest of the site
// uses (Layout's outlet context), so the page follows the site's language —
// there is no separate switcher.
//
// The offer's own content (menu names, dishes, inclusions, extras) stays in
// Bulgarian exactly as the PDF words it — see public/api/wedding-offer.json.

const bg = {
  meta: {
    title: "Конфигурирайте своята сватбена оферта",
    description:
      "Изберете меню, допълнителни услуги и детайли за Вашия сватбен ден в RAYA Garden и изпратете запитване за персонална оферта.",
  },
  intro: {
    eyebrow: "RAYA GARDEN",
    title: "Конфигурирайте своята сватбена оферта",
    lead: "Изберете меню, допълнителни услуги и детайли за Вашия ден. В края ще получите ориентировъчна стойност и ще можете да изпратите запитването си директно към нашия екип.",
  },
  steps: ["Дата и гости", "Избор на меню", "Допълнителни услуги", "Преглед и изпращане"],
  nav: { back: "Назад", next: "Напред", edit: "Редактирай", step: "Стъпка" },

  date: {
    legend: "Кога планирате тържеството",
    dateLabel: "Предпочитана дата",
    noDate: "Все още нямаме избрана дата",
    periodLabel: "Предпочитан месец или период (по избор)",
    periodPlaceholder: "напр. юни 2027 или края на лятото",
    guestsLegend: "Брой гости",
    standardLabel: "Гости със стандартно меню",
    standardHint: "Всеки възрастен гост, който получава стандартно меню.",
    childrenLabel: "Детско меню — за деца до 12 години",
    childrenHint: "Бройте всяко дете само тук — не и в гостите със стандартно меню.",
    totalLabel: "Общо гости",
    dateNotice:
      "Датата подлежи на потвърждение от екипа на хотела — тази форма не проверява наличност.",
    errStandard: "Моля, въведете поне 1 гост със стандартно меню.",
    errChildren: "Моля, въведете цяло число (0 или повече).",
    errDate: "Моля, изберете дата или отбележете, че още нямате избрана дата.",
  },

  included: {
    title: "Включено в пакета",
    badge: "Включено",
    note: "Тези услуги са част от пакетната цена на човек — не се доплащат.",
  },

  menus: {
    legend: "Стандартно меню",
    lead: "Изберете предпочитан вариант за тържеството. Всички варианти са на една и съща пакетна цена.",
    select: "Избери",
    selected: "Избрано",
    details: "Виж пълното меню",
    hide: "Скрий",
    sharedTitle: "Общо за всички варианти",
    servedWithTitle: "Към всяко стандартно меню се сервира",
    allocated: "Разпределени",
    errNoMenu: "Моля, изберете вариант на меню.",
    childTitle: "Детско меню",
    childLead: "Разпределете {n} детски менюта по варианти.",
    childSumError: "Сборът трябва да е равен на броя детски менюта ({n}).",
    upgradesTitle: "Надградете менюто",
    upgradesHint:
      "По избор — добавете или заменете степен в избрания вариант. Промяната се потвърждава от хотела.",
    upgradeOnRequest: "Цена по запитване",
    upgradePerGuest: "на човек",
    dietaryLabel: "Специални хранителни изисквания (по избор)",
    dietaryHint:
      "Алергии, вегетариански или други адаптации — възможността за промяна се потвърждава от хотела.",
  },

  extras: {
    pricedLegend: "Допълнителни услуги с цена",
    quotationLegend: "Услуги по индивидуална оферта",
    quotationNote:
      "Тези услуги не са част от пакета и офертата не посочва цена за тях. Част от тях се организират с наши доверени партньори, а други — от екипа на хотела. Не участват в ориентировъчната стойност — ще получите индивидуално предложение.",
    partnerBadge: "Чрез наш партньор",
    hotelBadge: "От хотела",
    quotationBadge: "По индивидуална оферта",
    add: "Добави",
    added: "Добавено",
    remove: "Премахни",
    perPerson: "на човек",
    perHour: "на час",
    fixed: "еднократно",
    coversLabel: "Брой гости за коктейла",
    hoursLabel: "Брой пълни часове",
    hoursHint: "Ориентировъчни часове — окончателната продължителност се потвърждава от хотела.",
    cateringTitle: "Изберете 3 вида хапки",
    cateringCounter: "Избрани: {n} от {max}",
    cateringError: "Моля, изберете точно {max} вида хапки.",
    notesLabel: "Бележка (по избор)",
    locationLabel: "Къде да бъде уелкъм коктейлът?",
    locationHint: "Изборът на място определя дали се начислява наем.",
    locationIncluded: "Без допълнителен наем",
    locationRequired: "Моля, изберете място за уелкъм коктейла.",
    unavailableWithLocation:
      "Не е налично при избраното място за ритуала. Сменете мястото по-горе, за да го добавите.",
    requiredBadge: "Задължително при избраното място",
    requiredNote:
      "Наемът се начислява автоматично заради избраното място за уелкъм коктейла.",
    overlapWarning:
      "Избрали сте няколко пространства/услуги за ритуала. Офертата не уточнява дали те се комбинират — стойността събира избраните позиции поотделно и комбинацията подлежи на потвърждение.",
    roomsLabel: "Приблизителен брой стаи",
    guestsLabel: "Приблизителен брой гости",
    nightsLabel: "Брой нощувки",
    otherLabel: "Други желания и въпроси",
    otherPlaceholder: "Разкажете ни всичко, което е важно за Вашия ден.",
  },

  summary: {
    title: "Вашата конфигурация",
    open: "Виж детайлите",
    close: "Скрий детайлите",
    date: "Дата",
    period: "Период",
    noDateYet: "Все още без избрана дата",
    guests: "Гости",
    guestsValue: "{a} със стандартно меню · {c} детски",
    menu: "Меню",
    childMenu: "Детско меню",
    rate: "Пакетна цена на човек",
    rateRange: "{min} или {max} — виж бележката",
    standardSubtotal: "Стандартни менюта",
    childSubtotal: "Детски менюта",
    extras: "Допълнителни услуги",
    quotation: "По индивидуална оферта",
    estimate: "Ориентировъчна стойност",
    estimateRange: "Ориентировъчна стойност: {min} – {max}",
    quotationExcluded:
      "Услугите по индивидуална оферта не са включени в изчислената стойност.",
    thresholdNote:
      "Офертата не уточнява дали децата с детско меню се броят към минимума от 60 души. Затова показваме и двете възможни цени — окончателната се потвърждава от хотела.",
    notBooking:
      "Изпращането на запитване не потвърждава резервация. Датата, наличността, избраните услуги и окончателната цена се потвърждават от екипа на RAYA Garden.",
    conditionsTitle: "Условия по офертата",
    validUntil: "Цените в офертата важат за резервации, направени до {date}.",
    expired:
      "Посочените в офертата цени важаха за резервации до {date}. Можете да изпратите запитване — актуалните цени ще бъдат потвърдени от екипа.",
    empty: "Изберете гости и меню, за да видите стойността.",
  },

  contact: {
    legend: "Вашите данни",
    lead: "Оставете данни за връзка, за да Ви изпратим персонална оферта.",
    name: "Име и фамилия",
    phone: "Телефон",
    email: "Имейл",
    message: "Допълнително съобщение (по избор)",
    consent: "Съгласен/на съм данните ми да бъдат използвани за отговор на запитването. Вижте",
    submit: "Изпрати запитване",
    submitting: "Изпращане…",
    success:
      "Благодарим Ви! Вашето запитване е изпратено. Екипът на RAYA Garden ще се свърже с Вас за уточняване на детайлите.",
    successRef: "Номер на запитването: {ref}",
    errRequired: "Моля, попълнете това поле.",
    errEmail: "Моля, въведете валиден имейл адрес.",
    errPhone: "Моля, въведете валиден телефонен номер.",
    errConsent: "Моля, потвърдете съгласието си.",
    errSend:
      "Съжаляваме — запитването не можа да бъде изпратено. Изборът Ви е запазен, моля опитайте отново или ни се обадете на {phone}.",
    fixErrors: "Моля, поправете отбелязаните полета.",
  },
};

const en = {
  meta: {
    title: "Configure your wedding offer",
    description:
      "Choose your menu, extra services and the details of your wedding day at RAYA Garden, then send us an enquiry for a personal offer.",
  },
  intro: {
    eyebrow: "RAYA GARDEN",
    title: "Configure your wedding offer",
    lead: "Choose your menu, extra services and the details of your day. At the end you'll see an indicative estimate and can send your enquiry straight to our team.",
  },
  steps: ["Date & guests", "Menu", "Extra services", "Review & send"],
  nav: { back: "Back", next: "Next", edit: "Edit", step: "Step" },

  date: {
    legend: "When are you planning the celebration",
    dateLabel: "Preferred date",
    noDate: "We haven't chosen a date yet",
    periodLabel: "Preferred month or period (optional)",
    periodPlaceholder: "e.g. June 2027 or late summer",
    guestsLegend: "Number of guests",
    standardLabel: "Guests on the standard menu",
    standardHint: "Every adult guest receiving a standard menu.",
    childrenLabel: "Children's menu — for children up to 12 years",
    childrenHint: "Count each child here only — not in the standard-menu guests.",
    totalLabel: "Total guests",
    dateNotice:
      "The date is subject to confirmation by the hotel team — this form does not check availability.",
    errStandard: "Please enter at least 1 guest on the standard menu.",
    errChildren: "Please enter a whole number (0 or more).",
    errDate: "Please pick a date, or tick that you haven't chosen one yet.",
  },

  included: {
    title: "Included in the package",
    badge: "Included",
    note: "These services are part of the per-person package price — nothing extra to pay.",
  },

  menus: {
    legend: "Standard menu",
    lead: "Choose your preferred variant. All variants are the same package price.",
    select: "Select",
    selected: "Selected",
    details: "See the full menu",
    hide: "Hide",
    sharedTitle: "Common to all variants",
    servedWithTitle: "Served with every standard menu",
    allocated: "Allocated",
    errNoMenu: "Please choose a menu variant.",
    childTitle: "Children's menu",
    childLead: "Allocate {n} children's menus across the variants.",
    childSumError: "The total must equal the number of children's menus ({n}).",
    upgradesTitle: "Upgrade the menu",
    upgradesHint:
      "Optional — add or replace a course in the chosen variant. Any change is confirmed by the hotel.",
    upgradeOnRequest: "Price on request",
    upgradePerGuest: "per person",
    dietaryLabel: "Special dietary requirements (optional)",
    dietaryHint:
      "Allergies, vegetarian or other adaptations — any change is confirmed by the hotel.",
  },

  extras: {
    pricedLegend: "Priced extra services",
    quotationLegend: "Services quoted individually",
    quotationNote:
      "These are not part of the package and the offer lists no price for them. Some are arranged through our trusted partners, others by the hotel's own team. They are not part of the indicative estimate — you'll receive an individual proposal.",
    partnerBadge: "Through a partner",
    hotelBadge: "By the hotel",
    quotationBadge: "Individual quotation",
    add: "Add",
    added: "Added",
    remove: "Remove",
    perPerson: "per person",
    perHour: "per hour",
    fixed: "fixed fee",
    coversLabel: "Guests for the cocktail",
    hoursLabel: "Number of whole hours",
    hoursHint: "Estimated hours — the final duration is confirmed by the hotel.",
    cateringTitle: "Choose 3 kinds of canapés",
    cateringCounter: "Selected: {n} of {max}",
    cateringError: "Please select exactly {max} kinds.",
    notesLabel: "Note (optional)",
    locationLabel: "Where should the welcome cocktail be held?",
    locationHint: "The place you choose decides whether a hire fee applies.",
    locationIncluded: "No extra hire fee",
    locationRequired: "Please choose where the welcome cocktail is held.",
    unavailableWithLocation:
      "Not available with the place chosen for the ceremony. Change the place above to add it.",
    requiredBadge: "Required by the place you chose",
    requiredNote:
      "This hire fee is added automatically because of the place chosen for the welcome cocktail.",
    overlapWarning:
      "You've selected several ceremony spaces/services. The offer doesn't say whether they combine — the estimate adds the selected items separately and the combination is subject to confirmation.",
    roomsLabel: "Approximate number of rooms",
    guestsLabel: "Approximate number of guests",
    nightsLabel: "Number of nights",
    otherLabel: "Other wishes and questions",
    otherPlaceholder: "Tell us anything that matters for your day.",
  },

  summary: {
    title: "Your configuration",
    open: "Show details",
    close: "Hide details",
    date: "Date",
    period: "Period",
    noDateYet: "No date chosen yet",
    guests: "Guests",
    guestsValue: "{a} on the standard menu · {c} children",
    menu: "Menu",
    childMenu: "Children's menu",
    rate: "Package price per person",
    rateRange: "{min} or {max} — see the note",
    standardSubtotal: "Standard menus",
    childSubtotal: "Children's menus",
    extras: "Extra services",
    quotation: "Individual quotation",
    estimate: "Indicative value",
    estimateRange: "Indicative value: {min} – {max}",
    quotationExcluded: "Individually quoted services are not included in the calculated value.",
    thresholdNote:
      "The offer doesn't say whether children on the children's menu count toward the minimum of 60 people. We therefore show both possible rates — the final one is confirmed by the hotel.",
    notBooking:
      "Sending an enquiry does not confirm a reservation. The date, availability, selected services and final price are confirmed by the RAYA Garden team.",
    conditionsTitle: "Offer conditions",
    validUntil: "The offer's prices apply to reservations made by {date}.",
    expired:
      "The offer's prices applied to reservations made by {date}. You can still send an enquiry — current pricing will be confirmed by the team.",
    empty: "Choose guests and a menu to see the value.",
  },

  contact: {
    legend: "Your details",
    lead: "Leave your contact details so we can send you a personal offer.",
    name: "Full name",
    phone: "Phone",
    email: "Email",
    message: "Additional message (optional)",
    consent: "I agree my details may be used to answer this enquiry. See the",
    submit: "Send enquiry",
    submitting: "Sending…",
    success:
      "Thank you! Your enquiry has been sent. The RAYA Garden team will contact you to confirm the details.",
    successRef: "Enquiry reference: {ref}",
    errRequired: "Please fill in this field.",
    errEmail: "Please enter a valid email address.",
    errPhone: "Please enter a valid phone number.",
    errConsent: "Please confirm your agreement.",
    errSend:
      "Sorry — the enquiry could not be sent. Your selections are kept; please try again or call us on {phone}.",
    fixErrors: "Please correct the highlighted fields.",
  },
};

const ro = {
  meta: {
    title: "Configurați-vă oferta de nuntă",
    description:
      "Alegeți meniul, serviciile suplimentare și detaliile zilei dumneavoastră la RAYA Garden și trimiteți-ne o solicitare pentru o ofertă personalizată.",
  },
  intro: {
    eyebrow: "RAYA GARDEN",
    title: "Configurați-vă oferta de nuntă",
    lead: "Alegeți meniul, serviciile suplimentare și detaliile zilei dumneavoastră. La final veți vedea o valoare orientativă și veți putea trimite solicitarea direct echipei noastre.",
  },
  steps: ["Data și invitații", "Meniu", "Servicii suplimentare", "Verificare și trimitere"],
  nav: { back: "Înapoi", next: "Înainte", edit: "Modifică", step: "Pasul" },

  date: {
    legend: "Când planificați petrecerea",
    dateLabel: "Data preferată",
    noDate: "Încă nu am ales o dată",
    periodLabel: "Luna sau perioada preferată (opțional)",
    periodPlaceholder: "de ex. iunie 2027 sau sfârșitul verii",
    guestsLegend: "Număr de invitați",
    standardLabel: "Invitați cu meniu standard",
    standardHint: "Fiecare invitat adult care primește un meniu standard.",
    childrenLabel: "Meniu pentru copii — pentru copii până la 12 ani",
    childrenHint: "Numărați fiecare copil doar aici — nu și la invitații cu meniu standard.",
    totalLabel: "Total invitați",
    dateNotice:
      "Data este supusă confirmării de către echipa hotelului — acest formular nu verifică disponibilitatea.",
    errStandard: "Vă rugăm să introduceți cel puțin 1 invitat cu meniu standard.",
    errChildren: "Vă rugăm să introduceți un număr întreg (0 sau mai mare).",
    errDate: "Alegeți o dată sau bifați că nu ați ales încă una.",
  },

  included: {
    title: "Incluse în pachet",
    badge: "Inclus",
    note: "Aceste servicii fac parte din prețul de pachet pe persoană — fără costuri suplimentare.",
  },

  menus: {
    legend: "Meniu standard",
    lead: "Alegeți varianta preferată. Toate variantele au același preț de pachet.",
    select: "Alege",
    selected: "Ales",
    details: "Vezi meniul complet",
    hide: "Ascunde",
    sharedTitle: "Comun tuturor variantelor",
    servedWithTitle: "Se servește la fiecare meniu standard",
    allocated: "Repartizate",
    errNoMenu: "Vă rugăm să alegeți o variantă de meniu.",
    childTitle: "Meniu pentru copii",
    childLead: "Repartizați {n} meniuri pentru copii pe variante.",
    childSumError: "Suma trebuie să fie egală cu numărul meniurilor pentru copii ({n}).",
    upgradesTitle: "Îmbunătățiți meniul",
    upgradesHint:
      "Opțional — adăugați sau înlocuiți un fel din varianta aleasă. Orice modificare se confirmă de hotel.",
    upgradeOnRequest: "Preț la cerere",
    upgradePerGuest: "pe persoană",
    dietaryLabel: "Cerințe alimentare speciale (opțional)",
    dietaryHint: "Alergii, vegetarian sau alte adaptări — orice modificare se confirmă de hotel.",
  },

  extras: {
    pricedLegend: "Servicii suplimentare cu preț",
    quotationLegend: "Servicii cu ofertă individuală",
    quotationNote:
      "Acestea nu fac parte din pachet și oferta nu indică un preț pentru ele. Unele se organizează prin partenerii noștri de încredere, altele de echipa hotelului. Nu intră în valoarea orientativă — veți primi o propunere individuală.",
    partnerBadge: "Prin partener",
    hotelBadge: "De la hotel",
    quotationBadge: "Ofertă individuală",
    add: "Adaugă",
    added: "Adăugat",
    remove: "Elimină",
    perPerson: "pe persoană",
    perHour: "pe oră",
    fixed: "taxă unică",
    coversLabel: "Invitați pentru cocktail",
    hoursLabel: "Număr de ore întregi",
    hoursHint: "Ore estimative — durata finală se confirmă de hotel.",
    cateringTitle: "Alegeți 3 tipuri de aperitive",
    cateringCounter: "Alese: {n} din {max}",
    cateringError: "Vă rugăm să alegeți exact {max} tipuri.",
    notesLabel: "Notă (opțional)",
    locationLabel: "Unde să aibă loc cocktailul de bun venit?",
    locationHint: "Locul ales stabilește dacă se percepe o taxă de închiriere.",
    locationIncluded: "Fără taxă suplimentară",
    locationRequired: "Vă rugăm să alegeți locul cocktailului de bun venit.",
    unavailableWithLocation:
      "Indisponibil pentru locul ales pentru ceremonie. Schimbați locul de mai sus pentru a-l adăuga.",
    requiredBadge: "Obligatoriu pentru locul ales",
    requiredNote:
      "Taxa se adaugă automat din cauza locului ales pentru cocktailul de bun venit.",
    overlapWarning:
      "Ați ales mai multe spații/servicii pentru ceremonie. Oferta nu precizează dacă se combină — valoarea adună pozițiile separat, iar combinația se confirmă de hotel.",
    roomsLabel: "Număr aproximativ de camere",
    guestsLabel: "Număr aproximativ de invitați",
    nightsLabel: "Număr de nopți",
    otherLabel: "Alte dorințe și întrebări",
    otherPlaceholder: "Spuneți-ne tot ce este important pentru ziua dumneavoastră.",
  },

  summary: {
    title: "Configurația dumneavoastră",
    open: "Vezi detaliile",
    close: "Ascunde detaliile",
    date: "Data",
    period: "Perioada",
    noDateYet: "Încă fără dată aleasă",
    guests: "Invitați",
    guestsValue: "{a} cu meniu standard · {c} copii",
    menu: "Meniu",
    childMenu: "Meniu pentru copii",
    rate: "Preț de pachet pe persoană",
    rateRange: "{min} sau {max} — vezi nota",
    standardSubtotal: "Meniuri standard",
    childSubtotal: "Meniuri pentru copii",
    extras: "Servicii suplimentare",
    quotation: "Ofertă individuală",
    estimate: "Valoare orientativă",
    estimateRange: "Valoare orientativă: {min} – {max}",
    quotationExcluded: "Serviciile cu ofertă individuală nu sunt incluse în valoarea calculată.",
    thresholdNote:
      "Oferta nu precizează dacă copiii cu meniu pentru copii intră în minimul de 60 de persoane. De aceea arătăm ambele prețuri posibile — cel final se confirmă de hotel.",
    notBooking:
      "Trimiterea unei solicitări nu confirmă o rezervare. Data, disponibilitatea, serviciile alese și prețul final se confirmă de echipa RAYA Garden.",
    conditionsTitle: "Condițiile ofertei",
    validUntil: "Prețurile ofertei sunt valabile pentru rezervări făcute până la {date}.",
    expired:
      "Prețurile ofertei au fost valabile pentru rezervări până la {date}. Puteți trimite o solicitare — prețurile actuale vor fi confirmate de echipă.",
    empty: "Alegeți invitații și meniul pentru a vedea valoarea.",
  },

  contact: {
    legend: "Datele dumneavoastră",
    lead: "Lăsați datele de contact pentru a vă trimite o ofertă personalizată.",
    name: "Nume și prenume",
    phone: "Telefon",
    email: "E-mail",
    message: "Mesaj suplimentar (opțional)",
    consent: "Sunt de acord ca datele mele să fie folosite pentru a răspunde solicitării. Vezi",
    submit: "Trimite solicitarea",
    submitting: "Se trimite…",
    success:
      "Vă mulțumim! Solicitarea dumneavoastră a fost trimisă. Echipa RAYA Garden vă va contacta pentru detalii.",
    successRef: "Numărul solicitării: {ref}",
    errRequired: "Vă rugăm să completați acest câmp.",
    errEmail: "Vă rugăm să introduceți o adresă de e-mail validă.",
    errPhone: "Vă rugăm să introduceți un număr de telefon valid.",
    errConsent: "Vă rugăm să confirmați acordul.",
    errSend:
      "Ne pare rău — solicitarea nu a putut fi trimisă. Selecțiile sunt păstrate; încercați din nou sau sunați-ne la {phone}.",
    fixErrors: "Vă rugăm să corectați câmpurile marcate.",
  },
};

const STRINGS = { bg, en, ro };

/** Site language → strings, with the site's own bg/en fallback order. */
export function weddingStrings(lang) {
  return STRINGS[lang] || STRINGS.en;
}

/** "Избрани: {n} от {max}" → "Избрани: 2 от 3". */
export function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m
  );
}
