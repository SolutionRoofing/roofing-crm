# Free plans and when to upgrade

The CRM runs on free plans to keep costs at $0 while it's being built and tried out. This page lists each limit, how to know you're close to it, and what to switch when you upgrade.

**Settings → Plan usage** in the app shows the numbers it can measure (photo storage, database size, emails sent) and turns red with a warning at 80% of a limit. The limits it checks are in `src/lib/plan-limits.ts`. Change them there if you upgrade or a provider changes its free plan.

The prices and limits below were checked in November 2026. Confirm them on each provider's pricing page before you buy.

## The limits, roughly in the order you'll hit them

| Service | Free limit | What happens at the limit | Upgrade | Cost |
|---|---|---|---|---|
| **Supabase** (database, logins, photos) | 1 GB of photo storage, roughly 2,000 to 3,000 job photos | Photo uploads fail | Supabase Pro: 100 GB | about $25/month |
| | 500 MB database | The database turns read-only | Pro: 8 GB | (same plan) |
| | No backups | If data is deleted by mistake, it can't be restored | Pro: daily backups | (same plan) |
| | The project pauses after 7 days with no activity | The app stops working until it's resumed in the Supabase dashboard. The email check below keeps it active. | Pro never pauses | (same plan) |
| **Resend** (email) | 100 emails a day, 3,000 a month | Emails over the limit fail, and the outbox retries them later | Resend Pro: 50,000 a month | about $20/month |
| **Vercel** (hosting) | Scheduled jobs run once a day at most | Follow-up emails go out every 30 minutes, through GitHub, instead of every 10 | Vercel Pro | about $20/month per person who deploys |
| | The terms say Hobby is for non-commercial use | Vercel can ask you to upgrade | | |
| **Address suggestions** | Photon: free, no account, but built on OpenStreetMap, so some houses are missing and it can be briefly busy | People type the rest of the address by hand | Google Places: add a `GOOGLE_MAPS_API_KEY` in Vercel (needs a Google Cloud billing account) | $0 within Google's free monthly allowance for a team this size |
| **GitHub Actions** (the email check) | 2,000 minutes a month for a private repo. The email check uses about 1,440. | The checks stop until the next month, so automatic follow-ups wait | Not needed once Vercel is on Pro | $0 |

## Upgrade in this order when the time comes

1. **Supabase Pro**: when photo storage reaches 80%, or before the whole team relies on the CRM every day, whichever comes first. Backups are the main reason.
2. **Resend Pro**: when you start sending marketing campaigns to your full customer list, or Plan usage warns about emails.
3. **Vercel Pro**: when the CRM is your main business tool, or you want follow-ups every 10 minutes.

## Switching the email check to Vercel after upgrading to Vercel Pro

1. In `vercel.json`, change `"schedule": "0 14 * * *"` to `"schedule": "*/10 * * * *"`, then commit and push.
2. On GitHub, open the repository, then **Actions → Send follow-up emails → ⋯ → Disable workflow**.

To go back to free, undo both steps.

## How the free email check works

`.github/workflows/send-emails.yml` calls `https://app.solutionroof.com/api/cron/send-emails` every 30 minutes, using the `CRON_SECRET` repository secret, which has the same value as in Vercel. Vercel also calls it once a day at 14:00 UTC as a backup. Estimates, invoices and the **Send now** button on the Emails page don't wait for either of these: they send immediately.

## Switching address suggestions to Google

1. In Google Cloud, create a project, turn on billing, enable **Places API (New)**, and create an API key restricted to that API.
2. In Vercel, add it as `GOOGLE_MAPS_API_KEY` (Settings → Environment Variables), then redeploy. The key stays on the server; browsers never see it.
3. Set a budget alert in Google Cloud so a surprise bill can't happen.

To go back to Photon, delete the variable and redeploy.
