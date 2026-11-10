# Setting up the Roofing CRM

This walks through connecting the app to Supabase (its database, logins and photo storage) and running it on this PC. Hosting on Vercel and sending email through Resend come later. Each step says who does it.

## 1. Create the Supabase project (you)

1. Sign up at supabase.com. The free plan is enough to start; upgrade to Pro (about $25 a month) before the team relies on it, for daily backups.
2. Create a new project. Pick a region near you, and save the database password in your password manager.
3. Open **Project Settings → API Keys** and copy three values into a new file called `.env.local` in this folder (start from `.env.example`):
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret key → `SUPABASE_SECRET_KEY`. Keep this one private: it can do anything in the database. To save it without pasting it anywhere, click the copy icon next to it, then run `powershell -ExecutionPolicy Bypass -File scripts\save-secret-key.ps1`. That puts it into `.env.local` straight from the clipboard.

## 2. Create the database (you or Claude)

In Supabase, open the **SQL Editor**. Paste in and run each file from `supabase/migrations/`, one at a time and in order:

1. `0001_schema.sql`: tables and permission rules
2. `0002_logic.sql`: automatic stage changes, follow-up emails, work orders
3. `0003_storage.sql`: the private photo bucket
4. `0004_defaults.sql`: starter email templates, follow-up rules and price list
5. `0005_profile_guard.sql`: protects owner accounts

## 3. Make yourself the owner (you, right after step 2)

The **first login created becomes the Owner**, so do this before inviting anyone:

- **Authentication → Users → Add user → Create new user**: enter your email and a password, and tick "Auto confirm user".

## 4. Lock down sign-ups and fix the email links (you)

- **Authentication → Sign In / Providers**: turn off **Allow new users to sign up**. Invites still work.
- **Authentication → URL Configuration**:
  - Site URL: `http://localhost:3000` for now. Change it to `https://crm.yourcompany.com` at launch.
  - Redirect URLs: add the same address followed by `/**`.
- The email templates can stay as Supabase ships them. The app accepts Supabase's standard invite and reset links (`/auth/accept` and `/auth/confirm`).
- Supabase's built-in email sender only allows a few emails an hour. Before inviting all 9 people, connect Resend under **Authentication → Emails → SMTP Settings**. That's the same Resend account the follow-up emails will use.

## 5. Run the app on this PC

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000 and sign in with the owner account from step 3.

## 6. Add crews and invite the team

Go to **Team** in the app:

1. Add each subcontractor crew.
2. Invite the 6 office, sales and production people with their roles.
3. Invite each crew lead with the **Crew** role and their crew selected.

Use people's real names. The importer matches sales reps from the prototype by name.

| Role | Can see and do |
|---|---|
| Owner | Everything, including managing other owners |
| Office | Everything except changing owners |
| Sales rep | All jobs, customers, estimates and invoices. No company settings or team management |
| Crew | Only their own crew's work orders (address, scope, materials, notes), with **no prices**. Can mark jobs started or done, add notes and photos |

## 7. Bring over the prototype data (optional)

1. In the prototype, go to **Settings → Download backup**.
2. Do a dry run first. It shows what would be imported and any warnings, without writing anything:

   ```bash
   npm run import:backup -- "C:\path\to\roofing-crm-backup-YYYY-MM-DD.json" --dry-run
   ```

3. Run it again without `--dry-run` to import.

Sample data is left out unless you add `--include-sample`. The import runs once, on a fresh database.

## Checking the database rules

```bash
npm test
```

This runs the permission and business-rule tests against a local copy of Postgres. It needs no Supabase account.
