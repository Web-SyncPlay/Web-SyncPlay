import { LegalPage } from "@/components/layout/LegalPage"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Use | Web-SyncPlay",
  description: "Simple terms for the free Web-SyncPlay hobby project.",
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      description="Simple rules for the free hobby instance at https://web-syncplay.de — not a commercial service contract."
    >
      <section className="space-y-2">
        <h2>Hobby project</h2>
        <p>
          Web-SyncPlay is a free, non-profit hobby project. This public instance
          is{" "}
          <a
            href="https://web-syncplay.de"
            className="text-foreground underline underline-offset-4"
          >
            https://web-syncplay.de
          </a>
          , operated by{" "}
          <a
            href="https://github.com/Yasamato"
            target="_blank"
            rel="noreferrer noopener"
            className="text-foreground underline underline-offset-4"
          >
            github.com/Yasamato
          </a>
          . It is provided “as is”, without uptime or feature guarantees. We may
          change or stop this public instance at any time.
        </p>
      </section>

      <section className="space-y-2">
        <h2>Self-hosting</h2>
        <p>
          The software is open source. These terms apply only to{" "}
          <a
            href="https://web-syncplay.de"
            className="text-foreground underline underline-offset-4"
          >
            https://web-syncplay.de
          </a>
          . If you self-host, you are responsible for your deployment (including
          your own imprint/privacy if required).
        </p>
      </section>

      <section className="space-y-2">
        <h2>Be decent</h2>
        <p>Do not use this instance to:</p>
        <ul>
          <li>Break the law or infringe others’ rights</li>
          <li>
            Share illegal content or abuse the service (spam, attacks, overload)
          </li>
          <li>
            Bypass room passwords or control links you are not meant to use
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>Media you add</h2>
        <p>
          You choose what to play (external links or local files). You are
          responsible for having the rights to do so. Local files are not stored
          as a library on our servers — only relayed from the providing browser
          with short-lived metadata/cache.
        </p>
      </section>

      <section className="space-y-2">
        <h2>Liability</h2>
        <p>
          Within the limits of applicable law, we are not liable for downtime,
          sync issues, or third-party media chosen by users. Mandatory
          liability (e.g. intent, gross negligence, injury to life/body/health)
          remains unaffected.
        </p>
      </section>
    </LegalPage>
  )
}
