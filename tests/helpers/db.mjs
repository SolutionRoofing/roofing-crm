// Test database: real Postgres (PGlite, in-process) plus minimal stand-ins for the
// parts of Supabase the migrations rely on (auth.users, auth.uid(), storage, API roles).
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  owner_id text default auth.uid()::text
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = path.join(root, 'supabase', 'migrations');
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(await readFile(path.join(dir, file), 'utf8'));
    } catch (err) {
      err.message = `${file}: ${err.message}`;
      throw err;
    }
  }
  return db;
}

/** Creates a login (auth.users row), which fires the profile trigger. */
export async function createUser(db, email, name = '') {
  const { rows } = await db.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [email, name],
  );
  return rows[0].id;
}

/** Runs fn inside a transaction as a signed-in API user (RLS applies). Rolls back on error. */
export async function as(db, userId, fn) {
  return db.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId || '']);
    return fn(tx);
  });
}

export async function asAnon(db, fn) {
  return db.transaction(async tx => {
    await tx.exec('set local role anon');
    return fn(tx);
  });
}

export const one = async (q, sql, params) => (await q.query(sql, params)).rows[0];
export const all = async (q, sql, params) => (await q.query(sql, params)).rows;
