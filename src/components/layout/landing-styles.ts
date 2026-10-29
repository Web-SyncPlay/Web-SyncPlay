/**
 * Shared Tailwind chrome for landing room-entry / media-check fields.
 * Keep height and border style at the call site (primary vs denser secondary).
 */
export const landingFieldShell =
  "flex w-full items-center gap-2 rounded-2xl border bg-background/70 px-3 shadow-lg shadow-black/20 backdrop-blur-md transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 sm:px-4"

/** Ghost the Input primitive so the shell owns border / focus ring. */
export const landingFieldInput =
  "min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"

export const landingResultCard =
  "flex w-full animate-in flex-col gap-3 rounded-xl border px-3 py-2.5 text-left duration-300 fade-in-0 slide-in-from-bottom-1 sm:flex-row sm:items-center"

export const landingFeedbackOk = "border-primary/35 bg-primary/10"
export const landingFeedbackBad = "border-destructive/40 bg-destructive/10"
