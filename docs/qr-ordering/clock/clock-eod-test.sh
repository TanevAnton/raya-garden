#!/usr/bin/env bash
# RAYA Garden QR меню → Clock EOD трансфер: същите 4 заявки като системата.
# Нужни: curl и jq. Попълнете променливите и пуснете: bash clock-eod-test.sh
set -euo pipefail
BASE="${BASE:-https://sky-eu1.clock-software.com/base_api/<абонамент>/<акаунт>}"
USER="${CLOCK_USER:?задайте CLOCK_USER}"; KEY="${CLOCK_KEY:?задайте CLOCK_KEY}"
COMPANY="${COMPANY:-7200455}"; CUR="${CUR:-EUR}"; TPL="${TPL:-1508218}"
PRINTER="${PRINTER:-DT279013}"; USN="${USN:-DT279013-9001-0000001}"; DAY="${DAY:-$(date +%F)}"
MARK="QR R-3Q9V #1 УНП $USN"
c(){ curl -sS --digest -u "$USER:$KEY" -H 'Accept: application/json' -H 'Content-Type: application/json' -X "$1" "$BASE$2" ${3:+-d "$3"}; echo; }
echo "1. Фолио";      R=$(c POST "/companies/$COMPANY/folios" "{\"company_folio\":{\"currency\":\"$CUR\"}}"); echo "$R"
F=$(echo "$R" | jq -r '.id // .folio.id // .company_folio.id'); echo "   фолио $F"
echo "2. Редове";     c POST "/folios/$F/charges/bulk" "{\"charges\":[{\"text\":\"Салата Цезар\",\"price\":\"9.90\",\"qty\":1,\"currency\":\"$CUR\",\"service_date\":\"$DAY\",\"print_text\":\"$MARK\",\"charge_template_id\":$TPL},{\"text\":\"Тирамису\",\"price\":\"5.90\",\"qty\":1,\"currency\":\"$CUR\",\"service_date\":\"$DAY\",\"print_text\":\"$MARK\",\"charge_template_id\":$TPL}]}"
echo "3. Плащане";    c POST "/folios/$F/credit_items" "{\"credit_item\":{\"currency\":\"$CUR\",\"value\":\"15.80\",\"text\":\"Продажба чрез ФУ с ИН $PRINTER\",\"payment_type\":\"card\",\"payment_sub_type\":\"\",\"reference\":\"$MARK\"}}"
echo "4. Затваряне";  c POST "/folios/$F/close" '{}'
echo "5. Проверка";   c GET "/folios/$F"
