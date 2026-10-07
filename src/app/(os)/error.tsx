"use client";

export default function OsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="section">
      <p className="kicker">Error</p>
      <h2>Something broke</h2>
      <p className="why">{error.message}</p>
      <button className="text-button" type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
