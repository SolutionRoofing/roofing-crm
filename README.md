# Roofing CRM (multi-user)

The shared version of the roofing CRM prototype. It runs on Next.js, uses Supabase for Postgres, logins and photo storage, and will be hosted on Vercel.

- **Setup:** see [SETUP.md](SETUP.md).
- **Database:** `supabase/migrations/`. Permissions are enforced with row-level security, so they hold even if someone calls the API directly.
- **Tests:** run `npm test`. It exercises the migrations on in-process Postgres (PGlite) and covers the permission rules, automations, money flow and the prototype importer.
- **Importer:** `scripts/import-backup.mjs` reads a backup file from the prototype.

## Status

| Phase | State |
|---|---|
| 1. Foundation: database, roles, logins, team invites, importer | Built and tested locally; not yet connected to Supabase |
| 2. Core screens: pipeline, jobs, customers, calendar, tasks | Next |
| 3. Photos in the cloud | Storage rules are in place; the upload screen isn't built yet |
| 4. PDF estimates and e-signing | — |
| 5. Automatic email sending (Resend) | The outbox and rules are in the database; the sender isn't built yet |
| 6. Launch on `crm.` subdomain | — |
