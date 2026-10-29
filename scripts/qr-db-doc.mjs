#!/usr/bin/env node
// The database description for НАП (Наредба Н-18, чл. 52в: every table and
// field of the sales database), in Bulgarian: docs/qr-ordering/nap/database-bg.md.
// The tables and columns come from a fresh database made by the code itself
// (public/api/qr/_lib/core.php); their descriptions from
// docs/qr-ordering/nap/db-fields-bg.mjs. A column without a description, or
// a description of a column that no longer exists, stops it: run it with
// every schema change.
//
//   node scripts/qr-db-doc.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GROUPS, TABLES } from "../docs/qr-ordering/nap/db-fields-bg.mjs";

const work = mkdtempSync(path.join(tmpdir(), "raya-db-doc-"));
writeFileSync(path.join(work, "config.php"), "<?php return [];\n");
const json = execFileSync("php", ["-r", `
  define('RAYA_QR', true);
  require 'public/api/qr/_lib/core.php';
  $pdo = qr_db();
  $out = ['version' => QR_VERSION, 'schema' => QR_SCHEMA_VERSION, 'tables' => []];
  foreach ($pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN) as $t) {
    foreach ($pdo->query("PRAGMA table_info($t)") as $c) $out['tables'][$t][] = [$c['name'], $c['type'], (int) $c['pk']];
  }
  echo json_encode($out);`], { encoding: "utf8", env: { ...process.env, RAYA_QR_CONFIG: path.join(work, "config.php"), RAYA_QR_DATA_DIR: path.join(work, "data") } });
rmSync(work, { recursive: true, force: true });
const db = JSON.parse(json);

const problems = [];
for (const [table, columns] of Object.entries(db.tables)) {
  if (!TABLES[table]) problems.push(`table ${table}: no description`);
  else for (const [col] of columns) if (!TABLES[table][1][col]) problems.push(`${table}.${col}: no description`);
}
for (const [table, [, fields]] of Object.entries(TABLES)) {
  if (!db.tables[table]) problems.push(`table ${table}: described, but not in the database`);
  else for (const col of Object.keys(fields)) if (!db.tables[table].some(([c]) => c === col)) problems.push(`${table}.${col}: described, but not in the database`);
}
const grouped = GROUPS.flatMap(([, t]) => t);
for (const table of Object.keys(db.tables)) if (!grouped.includes(table)) problems.push(`table ${table}: in no group`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const TYPE = { INTEGER: "цяло число", TEXT: "текст" };
let md = `# База данни на QR системата — описание на таблиците и полетата

Версия на софтуера ${db.version}, структура на базата v${db.schema}. СУБД:
SQLite 3, един файл (\`orders.sqlite\`) на сървъра на хостинга, извън публичната
папка на сайта. Създава се и се обновява от самата програма
(\`public/api/qr/_lib/core.php\`).

Времената са Unix време (секунди от 1.1.1970 г. UTC; на екрана — в часовата
зона на София). Сумите са в евроцентове (1250 = 12,50 €) и включват ДДС.
Нищо от продажбите, плащанията, бележките и журнала не се изтрива. Изтриват се
само личните данни на гостите (имена, имейли) след 3 дни.

Направено от \`scripts/qr-db-doc.mjs\` — не се редактира на ръка.
`;
for (const [title, tables] of GROUPS) {
  md += `\n## ${title}\n`;
  for (const table of tables) {
    const [about, fields] = TABLES[table];
    md += `\n### \`${table}\`\n\n${about}\n\n| Поле | Тип | Описание |\n| --- | --- | --- |\n`;
    for (const [col, type, pk] of db.tables[table]) md += `| \`${col}\`${pk ? " 🔑" : ""} | ${TYPE[type] || type} | ${fields[col]} |\n`;
  }
}
writeFileSync("docs/qr-ordering/nap/database-bg.md", md);
console.log(`docs/qr-ordering/nap/database-bg.md: ${Object.keys(db.tables).length} tables`);
