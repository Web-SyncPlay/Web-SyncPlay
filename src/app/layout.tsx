import { SiteFooter } from "@/components/layout/SiteFooter"
import { Toaster } from "@/components/ui/sonner"
import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"
import { AppProviders } from "./providers"

export const metadata: Metadata = {
  title: "Web-SyncPlay | Watch and listen in sync",
  description:
    "Create a room instantly, share one link, and keep video or music perfectly synced with friends.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <AppProviders>
          <div className="flex min-h-dvh flex-col">
            <main className="flex min-h-0 grow flex-col">{children}</main>
            <SiteFooter />
          </div>
        </AppProviders>
        <Toaster />
      </body>
    </html>
  )
}
