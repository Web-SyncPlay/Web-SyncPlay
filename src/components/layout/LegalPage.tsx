import { SiteNavbar } from "@/components/layout/SiteNavbar"
import type { ReactNode } from "react"

export function LegalPage(props: {
  title: string
  description?: string
  children: ReactNode
}) {
  const { title, description, children } = props

  return (
    <>
      <SiteNavbar home />
      <article className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8 space-y-2 border-b pb-6">
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
        </header>
        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground sm:text-base [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground sm:[&_h2]:text-lg [&_li]:mt-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
      </article>
    </>
  )
}
