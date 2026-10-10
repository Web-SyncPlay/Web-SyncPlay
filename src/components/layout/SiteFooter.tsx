"use client"

import { isPlayerEmbedPath } from "@/shared/room-utils"
import Link from "next/link"
import { usePathname } from "next/navigation"

const GITHUB_REPO = "https://github.com/Web-SyncPlay/Web-SyncPlay"
const GITHUB_AUTHOR = "https://github.com/Yasamato"

const legalLinks = [
  { href: "/imprint", label: "Imprint" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const

export function SiteFooter() {
  const pathname = usePathname() ?? ""
  if (isPlayerEmbedPath(pathname)) return null

  const year = new Date().getFullYear()

  return (
    <footer className="border-t px-3 py-3 text-xs text-muted-foreground sm:text-sm">
      <div className="mx-auto flex w-full flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <p>
          © {year}{" "}
          <Link
            href={GITHUB_AUTHOR}
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-foreground"
          >
            Yasamato
          </Link>
        </p>
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          {legalLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </Link>
        </nav>
      </div>
    </footer>
  )
}
