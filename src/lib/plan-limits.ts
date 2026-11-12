// Free-plan limits the app watches (see UPGRADES.md). Update these if you
// upgrade a service or the provider changes its free tier.
export const PLAN_LIMITS = {
  dbBytes: 500 * 1024 ** 2, // Supabase Free: 500 MB database
  storageBytes: 1024 ** 3, // Supabase Free: 1 GB file storage (photos)
  emailsPerDay: 100, // Resend Free: 100 emails a day
  emailsPerMonth: 3000, // Resend Free: 3,000 emails a month
};

/** Share of a limit at which the Settings page starts warning. */
export const WARN_AT = 0.8;
