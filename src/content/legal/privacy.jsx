import { H2, H3, P, Ul, Card, Row, A, L } from "../../components/LegalPage.jsx";
import { CONTROLLER as C } from "./controller.js";

// The privacy policy text, one component per language.
//
// Every recipient named below is one the site actually sends data to, checked
// against the code rather than assumed: the brief listed Meta, Google, the
// host and Sanity, and the code adds Clock PMS+ (the room booking engine),
// Formspree (the contact form), the OpenAI ads pixel and ipwho.is (country
// lookup for the language). A notice that leaves out a live recipient is not
// a notice.

const mail = <A href={`mailto:${C.email}`}>{C.email}</A>;
const phone = <A href={C.phoneHref}>{C.phone}</A>;

export function PrivacyBg() {
  return (
    <>
      <P>
        Тази политика обяснява какви лични данни събираме, когато посещавате
        rayagarden.bg, правите резервация или запитване или се свързвате с нас,
        защо го правим, на какво основание и какви права имате.
      </P>

      <H2>1. Кои сме ние</H2>
      <P>
        Администратор на личните данни е {C.legalName.bg}, ЕИК {C.eik}, със
        седалище и адрес на управление {C.registeredAddress.bg}.
      </P>
      <P>
        Търговско наименование: {C.tradingName}, {C.tradingAddress.bg}.
      </P>
      <P>
        За въпроси и искания относно личните Ви данни: {mail}, {phone}.
      </P>

      <H2>2. Какви данни събираме и защо</H2>

      <Card title="Резервации на стаи и маси, престой в хотела">
        <Row label="Данни">
          Име, телефон, имейл, дати на престоя, брой гости, специални желания
          и бележки към резервацията.
        </Row>
        <Row label="Основание">
          Изпълнение на договор — чл. 6, пар. 1, б. „б“ от ОРЗД.
        </Row>
        <Row label="Регистрация">
          При настаняване регистрираме гостите с данни от документ за
          самоличност, както изисква Законът за туризма — законово задължение,
          чл. 6, пар. 1, б. „в“ от ОРЗД.
        </Row>
      </Card>

      <Card title="Запитвания за събития и корпоративни мероприятия">
        <Row label="Откъде">
          Формулярите за потенциални клиенти във Facebook и Instagram, формата
          за контакт и сватбеният конфигуратор на сайта.
        </Row>
        <Row label="Данни">
          Име, телефон, имейл, фирма, месец на събитието, брой гости и
          съдържанието на запитването.
        </Row>
        <Row label="Основание">
          Предприемане на стъпки по Ваше искане преди сключване на договор —
          чл. 6, пар. 1, б. „б“ от ОРЗД.
        </Row>
      </Card>

      <Card title="Анализ на сайта и реклама">
        <Row label="Инструменти">
          Google Analytics 4, Google Tag Manager, Meta Pixel и рекламният пиксел
          на OpenAI (реклами в ChatGPT).
        </Row>
        <Row label="Данни">
          Идентификатори в бисквитки, IP адрес, тип устройство и браузър,
          посетени страници, откъде идвате (напр. от реклама) и действия на
          сайта — например изпратено запитване или начало на резервация.
        </Row>
        <Row label="Основание">
          Съгласие — чл. 6, пар. 1, б. „а“ от ОРЗД. Можете да оттеглите
          съгласието си по всяко време; подробности в{" "}
          <L to="/cookies">Политиката за бисквитки</L>.
        </Row>
      </Card>

      <Card title="Телефонни обаждания и имейли">
        <Row label="Данни">
          Име, телефонен номер или имейл адрес и съдържанието на разговора или
          кореспонденцията.
        </Row>
        <Row label="Основание">
          Легитимен интерес да отговорим на запитванията Ви и да водим
          кореспонденцията с Вас — чл. 6, пар. 1, б. „е“ от ОРЗД.
        </Row>
      </Card>

      <Card title="Показване на сайта на Вашия език">
        <Row label="Данни">
          Ако не сте избрали език, IP адресът Ви се изпраща към услугата
          ipwho.is, за да определим държавата и да покажем сайта на български,
          английски или румънски. Запазваме само избрания език на Вашето
          устройство.
        </Row>
        <Row label="Основание">
          Легитимен интерес — чл. 6, пар. 1, б. „е“ от ОРЗД.
        </Row>
      </Card>

      <P>
        Данните за резервация и регистрация са необходими, за да Ви настаним;
        без тях не можем да сключим договора. Не вземаме решения, основани
        единствено на автоматизирана обработка, които да имат правни последици
        за Вас.
      </P>

      <H2>3. На кого предаваме данните</H2>
      <P>
        Не продаваме лични данни. Предаваме ги само на доставчици, които ги
        обработват от наше име или сами за целите, описани по-горе:
      </P>
      <Ul>
        <li>
          <strong className="text-cream-50 font-normal">Meta Platforms Ireland Ltd</strong> —
          Meta Pixel и формулярите за потенциални клиенти във Facebook и
          Instagram.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">Google Ireland Ltd</strong> —
          Google Analytics 4, Google Tag Manager и шрифтовете на сайта (Google
          Fonts), при чието зареждане браузърът Ви изпраща IP адреса си към
          Google.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">SuperHosting.BG</strong> —
          хостинг на сайта в България, включително сървъра, който получава
          запитванията от сватбения конфигуратор.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">Sanity</strong> —
          системата, в която поддържаме текстовете и снимките на сайта. Не
          съхранява данни на гости.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">Clock Software (Clock PMS+)</strong> —
          системата за онлайн резервации на стаи.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">Formspree</strong> —
          доставя до нас съобщенията от формата за контакт.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">OpenAI</strong> —
          рекламният пиксел за реклами в ChatGPT.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">ipwho.is</strong> —
          определяне на държавата по IP адрес за избор на език.
        </li>
        <li>
          Държавни органи, когато законът го изисква — например при
          регистрацията на туристи или пред данъчните органи.
        </li>
      </Ul>

      <H2>4. Предаване на данни извън ЕС</H2>
      <P>
        Някои от тези доставчици, включително Google, Meta и OpenAI, могат да
        обработват данни в САЩ. Тогава предаването се основава на Рамката за
        защита на данните между ЕС и САЩ (EU–US Data Privacy Framework), когато
        получателят е сертифициран по нея, или на стандартни договорни клаузи,
        одобрени от Европейската комисия.
      </P>

      <H2>5. Колко дълго пазим данните</H2>
      <Ul>
        <li>
          Запитвания, които не са довели до резервация — 12 месеца от
          последния контакт с Вас.
        </li>
        <li>
          Данни за резервации и счетоводни документи — толкова, колкото
          изискват Законът за счетоводството и данъчното законодателство.
        </li>
        <li>
          Регистрационни данни на гостите — толкова, колкото изисква Законът за
          туризма.
        </li>
        <li>
          Данни за анализ и реклама — според настройките на съответния
          инструмент. Сроковете на отделните бисквитки са описани в{" "}
          <L to="/cookies">Политиката за бисквитки</L>.
        </li>
      </Ul>

      <H2>6. Вашите права</H2>
      <P>По отношение на личните си данни имате право:</P>
      <Ul>
        <li>на достъп — да научите какви данни обработваме за Вас и да получите копие;</li>
        <li>на коригиране на неточни или непълни данни;</li>
        <li>на изтриване („правото да бъдеш забравен“);</li>
        <li>на ограничаване на обработването;</li>
        <li>на преносимост — да получите данните си в машинночетим формат;</li>
        <li>на възражение срещу обработване, основано на легитимен интерес;</li>
        <li>
          да оттеглите съгласието си по всяко време, без това да засяга
          законността на обработването преди оттеглянето.
        </li>
      </Ul>
      <P>
        За да упражните което и да е от тези права, пишете ни на {mail} или ни
        се обадете на {phone}. Отговаряме в срок до един месец. Може да Ви
        помолим да потвърдите самоличността си, за да не разкрием данните Ви на
        друг човек.
      </P>

      <H2>7. Право на жалба</H2>
      <P>
        Ако смятате, че обработваме данните Ви в нарушение на закона, можете да
        подадете жалба до Комисията за защита на личните данни (КЗЛД),{" "}
        <A href="https://www.cpdp.bg">cpdp.bg</A>.
      </P>

      <H3>Промени</H3>
      <P>
        Когато променим тази политика, ще обновим датата в началото на
        страницата.
      </P>
    </>
  );
}

export function PrivacyEn() {
  return (
    <>
      <P>
        This policy explains what personal data we collect when you visit
        rayagarden.bg, make a booking or an enquiry, or get in touch with us —
        why we collect it, on what legal basis, and what your rights are.
      </P>

      <H2>1. Who we are</H2>
      <P>
        The data controller is {C.legalName.en}, EIK {C.eik}, with its
        registered address at {C.registeredAddress.en}.
      </P>
      <P>
        Trading name: {C.tradingName}, {C.tradingAddress.en}.
      </P>
      <P>
        For any question or request about your personal data: {mail}, {phone}.
      </P>

      <H2>2. What we collect and why</H2>

      <Card title="Room and table reservations, hotel stays">
        <Row label="Data">
          Name, phone, email, dates of stay, number of guests, special requests
          and notes on the booking.
        </Row>
        <Row label="Legal basis">
          Performance of a contract — GDPR Art. 6(1)(b).
        </Row>
        <Row label="Registration">
          On check-in we register guests using details from an identity
          document, as the Bulgarian Tourism Act requires — a legal obligation,
          GDPR Art. 6(1)(c).
        </Row>
      </Card>

      <Card title="Event and corporate enquiries">
        <Row label="Where from">
          Facebook and Instagram lead forms, the contact form and the wedding
          configurator on this site.
        </Row>
        <Row label="Data">
          Name, phone, email, company, event month, number of guests and the
          content of your enquiry.
        </Row>
        <Row label="Legal basis">
          Steps taken at your request before entering into a contract — GDPR
          Art. 6(1)(b).
        </Row>
      </Card>

      <Card title="Website analytics and advertising">
        <Row label="Tools">
          Google Analytics 4, Google Tag Manager, the Meta Pixel and the OpenAI
          advertising pixel (ChatGPT ads).
        </Row>
        <Row label="Data">
          Cookie identifiers, IP address, device and browser type, pages
          visited, where you came from (for example an ad) and actions on the
          site — such as sending an enquiry or starting a booking.
        </Row>
        <Row label="Legal basis">
          Consent — GDPR Art. 6(1)(a). You can withdraw it at any time; see
          the <L to="/cookies">Cookie Policy</L> for how.
        </Row>
      </Card>

      <Card title="Phone calls and emails">
        <Row label="Data">
          Name, phone number or email address, and what was said or written.
        </Row>
        <Row label="Legal basis">
          Legitimate interest in answering your enquiries and corresponding
          with you — GDPR Art. 6(1)(f).
        </Row>
      </Card>

      <Card title="Showing the site in your language">
        <Row label="Data">
          If you have not chosen a language, your IP address is sent to the
          ipwho.is service to determine your country, so we can show the site
          in Bulgarian, English or Romanian. Only the chosen language is kept,
          on your own device.
        </Row>
        <Row label="Legal basis">
          Legitimate interest — GDPR Art. 6(1)(f).
        </Row>
      </Card>

      <P>
        Booking and registration details are needed to accommodate you;
        without them we cannot enter into the contract. We do not make
        decisions based solely on automated processing that have legal
        effects on you.
      </P>

      <H2>3. Who we share data with</H2>
      <P>
        We do not sell personal data. We share it only with providers that
        process it on our behalf, or for their own part of the purposes above:
      </P>
      <Ul>
        <li>
          <strong className="text-cream-50 font-normal">Meta Platforms Ireland Ltd</strong> —
          the Meta Pixel, and Facebook and Instagram lead forms.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">Google Ireland Ltd</strong> —
          Google Analytics 4, Google Tag Manager, and the site's fonts (Google
          Fonts), which your browser loads from Google, sending it your IP
          address.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">SuperHosting.BG</strong> —
          hosts this site in Bulgaria, including the server that receives
          wedding configurator enquiries.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">Sanity</strong> — the
          content management system that holds the site's text and photos. It
          stores no guest data.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">Clock Software (Clock PMS+)</strong> —
          the online room booking system.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">Formspree</strong> —
          delivers messages sent through the contact form to us.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">OpenAI</strong> — the
          advertising pixel for ChatGPT ads.
        </li>
        <li>
          <strong className="text-cream-50 font-normal">ipwho.is</strong> —
          country lookup by IP address, for choosing the language.
        </li>
        <li>
          Public authorities, where the law requires it — for example tourist
          registration or the tax authorities.
        </li>
      </Ul>

      <H2>4. Transfers outside the EU</H2>
      <P>
        Some of these providers, including Google, Meta and OpenAI, may process
        data in the United States. Such transfers rely on the EU–US Data
        Privacy Framework where the recipient is certified under it, or on
        Standard Contractual Clauses approved by the European Commission.
      </P>

      <H2>5. How long we keep data</H2>
      <Ul>
        <li>
          Enquiries that do not become bookings — 12 months from our last
          contact with you.
        </li>
        <li>
          Booking and accounting records — as long as the Bulgarian Accounting
          Act and tax legislation require.
        </li>
        <li>
          Guest registration data — as long as the Tourism Act requires.
        </li>
        <li>
          Analytics and advertising data — according to each tool's settings.
          The lifetime of each cookie is listed in the{" "}
          <L to="/cookies">Cookie Policy</L>.
        </li>
      </Ul>

      <H2>6. Your rights</H2>
      <P>You have the right:</P>
      <Ul>
        <li>of access — to know what data we hold about you and receive a copy;</li>
        <li>to rectification of inaccurate or incomplete data;</li>
        <li>to erasure (the "right to be forgotten");</li>
        <li>to restriction of processing;</li>
        <li>to data portability — to receive your data in a machine-readable format;</li>
        <li>to object to processing based on legitimate interest;</li>
        <li>
          to withdraw your consent at any time, without affecting the
          lawfulness of processing before the withdrawal.
        </li>
      </Ul>
      <P>
        To exercise any of these rights, email us at {mail} or call {phone}.
        We reply within one month. We may ask you to confirm your identity so
        that we never disclose your data to someone else.
      </P>

      <H2>7. Complaints</H2>
      <P>
        If you believe we process your data unlawfully, you can complain to the
        Bulgarian Commission for Personal Data Protection (Комисия за защита на
        личните данни, КЗЛД),{" "}
        <A href="https://www.cpdp.bg">cpdp.bg</A>.
      </P>

      <H3>Changes</H3>
      <P>
        When we change this policy, we update the date at the top of the page.
      </P>
    </>
  );
}
