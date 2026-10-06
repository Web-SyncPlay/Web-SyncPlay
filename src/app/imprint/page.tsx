import { LegalPage } from "@/components/layout/LegalPage"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Imprint | Web-SyncPlay",
  description: "Legal imprint for the Web-SyncPlay hobby project.",
}

export default function ImprintPage() {
  return (
    <LegalPage
      title="Imprint"
      description="Provider information for the public instance at https://web-syncplay.de (§ 5 DDG). Web-SyncPlay is a free hobby project; anyone may self-host their own copy."
    >
      <section className="space-y-2">
        <h2>Operator of this instance</h2>
        <p>
          Public instance:{" "}
          <a
            href="https://web-syncplay.de"
            className="text-foreground underline underline-offset-4"
          >
            https://web-syncplay.de
          </a>
        </p>
        <p>
          Operator / contact:{" "}
          <a
            href="https://github.com/Yasamato"
            target="_blank"
            rel="noreferrer noopener"
            className="text-foreground underline underline-offset-4"
          >
            github.com/Yasamato
          </a>
        </p>
        <p>
          This is a non-commercial hobby project. No VAT identification number
          is issued.
        </p>
      </section>

      <section className="space-y-2">
        <h2>Self-hosting</h2>
        <p>
          The software is open source. If you run your own instance,{" "}
          <strong>you</strong> are the service provider for that deployment.
          This imprint applies only to{" "}
          <a
            href="https://web-syncplay.de"
            className="text-foreground underline underline-offset-4"
          >
            https://web-syncplay.de
          </a>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2>Third-party media</h2>
        <p>
          Rooms sync playback of media chosen by users (external URLs or files
          on a participant’s device). We do not operate a media library or
          curate that content. Liability for third-party information follows
          §§ 7–10 DDG.
        </p>
      </section>
    </LegalPage>
  )
}
