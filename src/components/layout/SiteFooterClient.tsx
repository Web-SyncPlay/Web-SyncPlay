"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { isPlayerEmbedPath } from "@/shared/room-utils"

const GITHUB_AUTHOR = "https://github.com/Yasamato"

const legalLinks = [
  { href: "/imprint", label: "Imprint" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const

const linkClass = "transition-colors hover:text-foreground"

export type SiteFooterClientProps = {
  githubRepoUrl: string
  appVersion: string
  appReleaseUrl: string
  gitShaShort: string | null
  gitCommitUrl: string | null
  ytDlpVersion: string | null
  ytDlpReleaseUrl: string | null
}

export function SiteFooterClient({
  githubRepoUrl,
  appVersion,
  appReleaseUrl,
  gitShaShort,
  gitCommitUrl,
  ytDlpVersion,
  ytDlpReleaseUrl,
}: SiteFooterClientProps) {
  const pathname = usePathname() ?? ""
  if (isPlayerEmbedPath(pathname)) return null

  const year = new Date().getFullYear()

  return (
    <footer className="border-t px-3 py-3 text-xs text-muted-foreground sm:text-sm">
      <div className="mx-auto flex w-full flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p>
            © {year}{" "}
            <Link
              href={GITHUB_AUTHOR}
              target="_blank"
              rel="noreferrer noopener"
              className={linkClass}
            >
              Yasamato
            </Link>
          </p>
          <span aria-hidden="true">·</span>
          <span
            aria-label="Build information"
            className="inline-flex flex-wrap items-center gap-x-1.5"
          >
            <Link
              href={githubRepoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={linkClass}
            >
              Source
            </Link>
            <span className="inline-flex items-baseline gap-x-0.5">
              <Link
                href={appReleaseUrl}
                target="_blank"
                rel="noreferrer noopener"
                className={linkClass}
                title={`Web-SyncPlay v${appVersion}`}
              >
                v{appVersion}
              </Link>
              {gitShaShort && gitCommitUrl ? (
                <Link
                  href={gitCommitUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={`font-mono ${linkClass}`}
                  title={`Commit ${gitShaShort}`}
                >
                  ({gitShaShort})
                </Link>
              ) : null}
            </span>
            {ytDlpVersion && ytDlpReleaseUrl ? (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  href={ytDlpReleaseUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={linkClass}
                  title={`yt-dlp ${ytDlpVersion}`}
                >
                  yt-dlp {ytDlpVersion}
                </Link>
              </>
            ) : null}
          </span>
        </div>
        <nav
          aria-label="Legal"
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
