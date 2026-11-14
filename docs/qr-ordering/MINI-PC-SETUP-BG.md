# Мини компютърът за касата: настройка от нулата

Prestigio PSMPC100 (Intel N100), за фискалния принтер на онлайн плащанията.
Йон компютърс (14.11.2026): Ubuntu може да се преинсталира, гаранцията не се
засяга. Новата инсталация изтрива DisplayForce и всеки отдалечен достъп, който
е бил на него.

```
rayagarden.bg  ⇄  мостът  →  ErpNet.FP  →  Datecs FP-700MX (192.168.0.175)
                 └──── мини компютърът ────┘
```

Време: около час и половина, повечето е чакане.

## Какво трябва

- USB флашка 8 GB или повече (всичко на нея се изтрива);
- монитор с HDMI, клавиатура и мишка, само за настройката;
- LAN кабел към същия рутер, към който е принтерът;
- Mac-ът, за да се направи флашката.

## 1. Флашката с Ubuntu (на Mac-а)

1. Изтеглете **Ubuntu 24.04 LTS Desktop** от https://ubuntu.com/download/desktop
   (файл `ubuntu-24.04.x-desktop-amd64.iso`, около 6 GB).
2. Изтеглете **balenaEtcher** от https://etcher.balena.io и го отворете.
3. „Flash from file“ → ISO файлът → „Select target“ → флашката → „Flash!“.
   Mac-ът може да пита за паролата си и после да каже, че не чете диска:
   натиснете „Ignore“/„Eject“.

## 2. Тръгване от флашката

1. Мини компютърът изключен. Сложете флашката, монитора, клавиатурата и LAN
   кабела.
2. Включете го и веднага натискайте многократно **F7** (менюто за избор на
   диск). Ако не стане, опитайте с **Esc** или **F11**; с **Del** се влиза в
   BIOS.
3. Изберете флашката (`UEFI: …` с името ѝ) → „Try or Install Ubuntu“.

**Докато сте в BIOS** (Del при включване), ако има такава настройка:
„Restore on AC Power Loss“ / „State After G3“ → **Power On**. Така след спиране
на тока компютърът тръгва сам. Обикновено е в Advanced → Chipset или Power.
„Save & Exit“.

## 3. Инсталацията

1. Език: **English** (съобщенията за грешки се търсят по-лесно). Клавиатура:
   English (US). По-късно се добавя и Bulgarian.
2. Мрежа: кабелът е достатъчен, Wi-Fi не трябва.
3. „Interactive installation“ → „Default selection“.
4. „Install third-party software“: да.
5. **„Erase disk and install Ubuntu“**. Това трие всичко, включително
   DisplayForce.
6. Потребител:
   - име: `raya`;
   - име на компютъра: `raya-kasa`;
   - парола: нова, силна. Запишете я в мениджъра за пароли, не в чат или
     имейл;
   - „Require my password to log in“: да.
7. Часова зона: **Sofia**.
8. „Install“. След около 15 минути: „Restart now“, извадете флашката и
   натиснете Enter.

## 4. След първото влизане

Отворете **Terminal** (Ctrl+Alt+T). Всяка команда се пуска сама; `sudo` пита
паролата от стъпка 3.

Обновяване:

```bash
sudo apt update && sudo apt full-upgrade -y
```

Компютърът никога да не заспива:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

И в Settings → Power: „Screen Blank“ може да е 5 минути, но „Automatic
Suspend“ е **Off**.

Часът (мостът сверява принтера по него):

```bash
timedatectl
```

Трябва да пише `Time zone: Europe/Sofia` и `System clock synchronized: yes`.

Принтерът се вижда по мрежата:

```bash
ping -c 3 192.168.0.175
```

Три отговора `64 bytes from 192.168.0.175` = добре. Ако няма: принтерът
включен ли е и с кабел ли е, и дали адресът му не се е сменил (самотест на
принтера).

**В рутера** запазете адреса на принтера, за да не се сменя: DHCP reservation
за MAC `68:aa:d2:2f:49:7f` → `192.168.0.175`.

## 5. Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt install -y nodejs
```

```bash
node -v
```

Трябва да започва с `v22`.

## 6. ErpNet.FP (програмата, която говори с принтера)

Изтегляне, в `/opt/erpnet-fp`. Версията е същата, с която тествахме на Mac-а:

```bash
cd /tmp && wget https://github.com/erpnet/ErpNet.FP/releases/download/v1.1.0.1694/linux-x64.zip
```

```bash
sudo mkdir -p /opt/erpnet-fp && sudo unzip -o /tmp/linux-x64.zip -d /opt/erpnet-fp && sudo chown -R raya:raya /opt/erpnet-fp && chmod +x /opt/erpnet-fp/ErpNet.FP.Server
```

Ако `wget` каже 404, отворете https://github.com/erpnet/ErpNet.FP/releases,
изтеглете `linux-x64.zip` от последната версия и пуснете втората команда.

Настройките: принтерът по мрежата, ErpNet.FP само за този компютър (не се
вижда от другите в мрежата). Цялата команда наведнъж:

```bash
cat > /opt/erpnet-fp/appsettings.json <<'EOF'
{
  "ErpNet.FP": {
    "AutoDetect": false,
    "Printers": {
      "dt055322": { "Id": "dt055322", "Uri": "bg.dt.x.isl.tcp://192.168.0.175:4999" }
    },
    "PrintersProperties": {
      "DA055322": {
        "PaymentTypeMappings": {},
        "PrinterConstants": {},
        "PrinterOptions": { "supportPaymentTerminal": "True", "usePaymentTerminal": "False" }
      }
    },
    "UdpBeaconPort": 8001,
    "ExcludePortList": "",
    "DetectionTimeout": 30,
    "WebAccess": { "AllowedOrigins": [], "EnablePrivateNetwork": false }
  },
  "Kestrel": { "EndPoints": { "Http": { "Url": "http://127.0.0.1:8001" } } }
}
EOF
```

Като услуга, която тръгва сама при включване. Цялата команда наведнъж:

```bash
sudo tee /etc/systemd/system/erpnet-fp.service >/dev/null <<'EOF'
[Unit]
Description=ErpNet.FP (fiscal printer server)
After=network-online.target
Wants=network-online.target

[Service]
User=raya
WorkingDirectory=/opt/erpnet-fp
ExecStart=/opt/erpnet-fp/ErpNet.FP.Server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now erpnet-fp
```

Проверка (след 10–20 секунди):

```bash
curl -s http://127.0.0.1:8001/printers
```

Трябва да има `"dt055322"` с `"serialNumber":"DA055322"`. Ако е `{}`, накарайте
го да потърси принтера наново:

```bash
curl -s -X POST http://127.0.0.1:8001/service/printers/configure -H 'Content-Type: application/json' -d '{"Id":"dt055322","Uri":"bg.dt.x.isl.tcp://192.168.0.175:4999"}'
```

```bash
curl -s http://127.0.0.1:8001/service/detect
```

Логът, ако нещо не върви: `journalctl -u erpnet-fp -f` (изход: Ctrl+C).

Тук спрете, ако сайтът още не е пуснат с касата: ErpNet.FP вижда принтера и
останалото е за деня на пускането.

## 7. Мостът (в деня на пускането)

Мостът тръгва, когато касата е пусната на сайта (`QR_FISCAL_MODE` = `test`,
после `live`) и е направен ключът `QR_FISCAL_BRIDGE_TOKEN`. Дотогава няма към
какво да се свърже.

1. Копирайте папката `tools/fiscal-bridge` от проекта на флашка, а от нея в
   домашната папка на мини компютъра. После:

   ```bash
   sudo cp -r ~/fiscal-bridge /opt/ && sudo chown -R raya:raya /opt/fiscal-bridge
   ```

2. Инсталирайте го като услуга:

   ```bash
   cd /opt/fiscal-bridge && sudo ./install-linux.sh
   ```

   Пита:
   - сайта: Enter (`https://rayagarden.bg`);
   - ErpNet.FP: Enter (`http://localhost:8001`);
   - принтера: `dt055322`;
   - ключа: поставете го (не се вижда, докато се пише). Ключът се пише само
     тук и в GitHub, никъде другаде.

   Накрая пише проверката: ErpNet.FP ✓, принтерът ✓, сайтът ✓.
3. На таблета, в „За касата“, червената лента „Касата за онлайн плащания не
   отговаря“ изчезва до минута.

## 8. По желание: достъп от Mac-а

За да може проверката и обновяването на моста да стават от Mac-а, без
монитор и клавиатура на мини компютъра:

```bash
sudo apt install -y openssh-server
```

Достъпът е само от мрежата на хотела. Влизането става с паролата от стъпка 3,
а по-добре с ключ (на Mac-а: `ssh-copy-id raya@raya-kasa.local`).

## Накрая

Изключете монитора, клавиатурата и мишката. Мини компютърът остава само със
захранване и LAN кабел, до принтера.

- след спиране на тока тръгва сам (BIOS), а ErpNet.FP и мостът тръгват сами
  (услугите);
- Ubuntu сам слага обновленията по сигурността;
- рестарт на всичко: изключване и включване от бутона, или
  `sudo systemctl restart erpnet-fp raya-fiscal-bridge`.
