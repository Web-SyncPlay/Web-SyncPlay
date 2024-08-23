"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <h1>Oh no! Something is totally messed up...</h1>

        <h3>{error.name}</h3>
        <p>{error.message}</p>

        <h3>Cause</h3>
        <p>{error.cause ? JSON.stringify(error.cause) : "Unknown cause"}</p>

        <h3>Stack</h3>
        <p>{error.stack ? error.stack : "No stacktrace found"}</p>

        <button onClick={() => reset()}>Reset page</button>
      </body>
    </html>
  );
}
