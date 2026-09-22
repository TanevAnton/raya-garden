import { H2, P, Ul, Card, Row, A, L } from "../../components/LegalPage.jsx";

// Every entry below was observed on the live site, not copied from a vendor
// list: a fresh browser was sent through /events (arriving with an fbclid,
// the way an ad click does), /hotel and /book with the Clock booking window
// opened, every document.cookie and Storage write was attributed to the
// script that made it, and the cookie jar was read at the end. Opening the
// booking window added nothing.
//
// Lifetimes are the vendor's own settings. _ga and _ga_* are set for two
// years; Chrome caps any cookie at 400 days, which is what a Chrome user
// actually gets — "up to 2 years" is true of both.
//
// Re-audit when a tag is added to GTM: a new tag can set a new cookie without
// any change to this repo.

const KIND = {
  necessary: { bg: "Необходими", en: "Strictly necessary" },
  analytics: { bg: "Анализ", en: "Analytics" },
  advertising: { bg: "Реклама", en: "Advertising" },
};

const COOKIES = [
  {
    name: "_ga",
    provider: "Google (Google Analytics 4)",
    kind: "analytics",
    lifetime: { bg: "до 2 години", en: "up to 2 years" },
    purpose: {
      bg: "Разграничава отделните посетители, за да измерваме посещаемостта на сайта.",
      en: "Distinguishes one visitor from another so we can measure site traffic.",
    },
  },
  {
    name: "_ga_CCY6SD302S",
    provider: "Google (Google Analytics 4)",
    kind: "analytics",
    lifetime: { bg: "до 2 години", en: "up to 2 years" },
    purpose: {
      bg: "Пази състоянието на сесията за нашия профил в Google Analytics.",
      en: "Keeps the session state for our Google Analytics property.",
    },
  },
  {
    name: "_fbp",
    provider: "Meta",
    kind: "advertising",
    lifetime: { bg: "90 дни", en: "90 days" },
    purpose: {
      bg: "Разпознава браузъра Ви, за да измерваме рекламите във Facebook и Instagram и да ги показваме на подходящи хора.",
      en: "Recognises your browser so we can measure Facebook and Instagram ads and show them to relevant people.",
    },
  },
  {
    name: "_fbc",
    provider: "Meta",
    kind: "advertising",
    lifetime: { bg: "90 дни", en: "90 days" },
    purpose: {
      bg: "Запазва идентификатора на кликването, когато идвате от реклама във Facebook или Instagram. Поставя се само в този случай.",
      en: "Stores the click identifier when you arrive from a Facebook or Instagram ad. Set only in that case.",
    },
  },
  {
    name: "__obref",
    provider: "OpenAI",
    kind: "advertising",
    lifetime: { bg: "365 дни", en: "365 days" },
    purpose: {
      bg: "Използва се от рекламния пиксел на OpenAI за отчитане на рекламите в ChatGPT.",
      en: "Used by the OpenAI advertising pixel to measure ChatGPT ads.",
    },
  },
];

const STORAGE = [
  {
    name: "raya.lang",
    provider: "RAYA Garden",
    kind: "necessary",
    where: { bg: "localStorage", en: "localStorage" },
    lifetime: { bg: "до изтриване от браузъра", en: "until you clear it" },
    purpose: {
      bg: "Запомня избрания език на сайта.",
      en: "Remembers the language you chose for the site.",
    },
  },
  {
    name: "lastExternalReferrer, lastExternalReferrerTime, multiFbc",
    provider: "Meta",
    kind: "advertising",
    where: { bg: "localStorage", en: "localStorage" },
    lifetime: { bg: "до изтриване от браузъра", en: "until you clear it" },
    purpose: {
      bg: "Помагат на Meta Pixel да свърже посещението с рекламата, от която идвате.",
      en: "Help the Meta Pixel link your visit to the ad you came from.",
    },
  },
  {
    name: "oaiq_cs:…",
    provider: "OpenAI",
    kind: "advertising",
    where: { bg: "sessionStorage", en: "sessionStorage" },
    lifetime: { bg: "до затваряне на раздела", en: "until the tab is closed" },
    purpose: {
      bg: "Пази състоянието на рекламния пиксел на OpenAI за текущото посещение.",
      en: "Keeps the OpenAI advertising pixel's state for the current visit.",
    },
  },
];

function Entry({ item, lang, labels }) {
  return (
    <Card title={<span className="font-mono text-base break-all">{item.name}</span>}>
      <Row label={labels.provider}>{item.provider}</Row>
      <Row label={labels.purpose}>{item.purpose[lang]}</Row>
      {item.where && <Row label={labels.where}>{item.where[lang]}</Row>}
      <Row label={labels.lifetime}>{item.lifetime[lang]}</Row>
      <Row label={labels.kind}>{KIND[item.kind][lang]}</Row>
    </Card>
  );
}

const LABELS = {
  bg: { provider: "Доставчик", purpose: "Цел", where: "Къде", lifetime: "Срок", kind: "Вид" },
  en: { provider: "Provider", purpose: "Purpose", where: "Where", lifetime: "Lifetime", kind: "Type" },
};

export function CookiesBg() {
  const labels = LABELS.bg;
  return (
    <>
      <P>
        Бисквитките са малки файлове, които сайтът записва в браузъра Ви.
        Подобно на тях, някои данни се пазят в хранилището на браузъра
        (localStorage и sessionStorage). Тук изброяваме всички, които
        rayagarden.bg поставя, кой ги поставя и за колко време.
      </P>

      <H2>Необходими и незадължителни</H2>
      <P>
        Необходимите — като запомнянето на езика — са нужни, за да работи
        сайтът така, както сте поискали, и не изискват съгласие.
      </P>
      <P>
        Бисквитките за анализ и реклама не са необходими за работата на сайта.
        Съгласно Закона за електронните съобщения и Общия регламент относно
        защитата на данните те изискват Вашето съгласие, което можете да
        оттеглите по всяко време.
      </P>

      <H2>Бисквитки</H2>
      {COOKIES.map((c) => (
        <Entry key={c.name} item={c} lang="bg" labels={labels} />
      ))}

      <H2>Хранилище на браузъра</H2>
      {STORAGE.map((s) => (
        <Entry key={s.name} item={s} lang="bg" labels={labels} />
      ))}
      <P>
        Системата за онлайн резервации Clock PMS+ се отваря в прозорец върху
        сайта и не поставя бисквитки на rayagarden.bg.
      </P>

      <H2>Как да управлявате бисквитките</H2>
      <Ul>
        <li>
          Можете да изтриете вече поставените бисквитки и да блокирате нови от
          настройките на браузъра си.
        </li>
        <li>
          Google предлага добавка за браузъра, която спира Google Analytics:{" "}
          <A href="https://tools.google.com/dlpage/gaoptout">
            tools.google.com/dlpage/gaoptout
          </A>
          .
        </li>
        <li>
          Рекламите на Meta можете да настроите от{" "}
          <A href="https://www.facebook.com/adpreferences">
            facebook.com/adpreferences
          </A>
          .
        </li>
      </Ul>
      <P>
        Как обработваме данните, събрани чрез бисквитките, и какви права
        имате, е описано в <L to="/privacy-policy">Политиката за поверителност</L>.
      </P>
    </>
  );
}

export function CookiesEn() {
  const labels = LABELS.en;
  return (
    <>
      <P>
        Cookies are small files a website stores in your browser. Similar data
        can also be kept in the browser's storage (localStorage and
        sessionStorage). This page lists everything rayagarden.bg stores, who
        stores it and for how long.
      </P>

      <H2>Necessary and optional</H2>
      <P>
        Strictly necessary items — such as remembering your language — are
        needed for the site to work the way you asked, and do not require
        consent.
      </P>
      <P>
        Analytics and advertising cookies are not needed for the site to work.
        Under the Bulgarian Electronic Communications Act and the GDPR they
        require your consent, which you can withdraw at any time.
      </P>

      <H2>Cookies</H2>
      {COOKIES.map((c) => (
        <Entry key={c.name} item={c} lang="en" labels={labels} />
      ))}

      <H2>Browser storage</H2>
      {STORAGE.map((s) => (
        <Entry key={s.name} item={s} lang="en" labels={labels} />
      ))}
      <P>
        The Clock PMS+ online booking system opens in a window over the site
        and sets no cookies on rayagarden.bg.
      </P>

      <H2>How to control cookies</H2>
      <Ul>
        <li>
          You can delete cookies already set, and block new ones, in your
          browser's settings.
        </li>
        <li>
          Google offers a browser add-on that stops Google Analytics:{" "}
          <A href="https://tools.google.com/dlpage/gaoptout">
            tools.google.com/dlpage/gaoptout
          </A>
          .
        </li>
        <li>
          You can adjust Meta's ads at{" "}
          <A href="https://www.facebook.com/adpreferences">
            facebook.com/adpreferences
          </A>
          .
        </li>
      </Ul>
      <P>
        How we process data collected through cookies, and your rights, are
        set out in the <L to="/privacy-policy">Privacy Policy</L>.
      </P>
    </>
  );
}
