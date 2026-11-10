'use client';

// Shown when a page or a save fails, instead of a blank screen.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel" role="alert">
      <h2>Something went wrong</h2>
      <p className="muted" style={{ margin: '6px 0 12px' }}>
        {error.message && !error.message.includes('digest') ? error.message : 'The last action did not go through.'} Nothing else was changed.
      </p>
      <button className="btn primary" onClick={reset}>Try again</button>
    </div>
  );
}
