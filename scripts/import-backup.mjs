#!/usr/bin/env node
// Imports a prototype backup into Supabase. Run once, on a fresh database, after
// inviting your team (so sales reps match their logins by name).
//
//   npm run import:backup -- path\to\roofing-crm-backup.json [--include-sample] [--dry-run]
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (the service key) in .env.local.
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { transformBackup, runImport } from './lib/transform.mjs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const includeSample = args.includes('--include-sample');
const dryRun = args.includes('--dry-run');
if (!file) {
  console.error('Usage: npm run import:backup -- <backup.json> [--include-sample] [--dry-run]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const check = ({ error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); };

const backup = JSON.parse(await readFile(file, 'utf8'));
const { data: profiles, error } = await sb.from('profiles').select('id, full_name, email').eq('active', true);
if (error) throw new Error(`Reading logins: ${error.message}`);

const result = transformBackup(backup, { includeSample, profiles });
console.log(`Found ${result.tables.jobs.length} jobs, ${result.tables.contacts.length} customers, ${result.tables.documents.length} estimates/invoices, ${result.photos.length} photos.`);
for (const w of result.warnings) console.warn(`! ${w}`);
if (dryRun) { console.log('Dry run: nothing was written.'); process.exit(0); }

await runImport(result, {
  async countImportedJobs() {
    const { count, error: e } = await sb.from('jobs').select('id', { count: 'exact', head: true }).not('legacy_id', 'is', null);
    if (e) throw new Error(e.message);
    return count || 0;
  },
  async deleteAll(table) { check(await sb.from(table).delete().not('id', 'is', null), `Clearing ${table}`); },
  async insert(table, rows) { if (rows.length) check(await sb.from(table).insert(rows), `Writing ${table}`); },
  async updateSettings(row) { check(await sb.from('settings').update(row).eq('id', 1), 'Writing settings'); },
  async upload(path, buffer, contentType) {
    check(await sb.storage.from('job-photos').upload(path, buffer, { contentType, upsert: false }), `Uploading ${path}`);
  },
  async syncSequences() { check(await sb.rpc('sync_number_sequences'), 'Updating job numbers'); },
}, line => console.log(`  ${line}`));
console.log('Import finished.');
