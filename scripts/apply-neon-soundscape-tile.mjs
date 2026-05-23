#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = value;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dsn = String(args.dsn || process.env.NEON_DSN || "").trim();
  const sqlFile = String(args.file || "sql/soundscape_tile.sql").trim();

  if (!dsn) {
    throw new Error("NEON_DSN is required. Pass --dsn or set NEON_DSN in environment.");
  }

  const sqlText = await readFile(sqlFile, "utf8");
  const query = sqlText.trim();
  if (!query) {
    throw new Error(`SQL file is empty: ${sqlFile}`);
  }

  const exec = neon(dsn, { fetchOptions: { cache: "no-store" } });
  await exec.query(query);

  console.log(`Applied soundscape_tile() SQL from ${sqlFile}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
