import { LegalPage } from "@/components/layout/LegalPage"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Imprint | Web-SyncPlay",
  description: "Legal imprint and provider information for Web-SyncPlay.",
}

export default function ImprintPage() {
  return (
    <LegalPage
      title="Imprint"
      description="Information pursuant to § 5 DDG (Digitale-Dienste-Gesetz) / formerly TMG."
    >
      <section className="space-y-2">
        <h2>Service provider</h2>
        <p>
          <strong>[TODO: Full legal name]</strong>
          <br />
          [TODO: Street and house number]
          <br />
          [TODO: Postal code and city]
          <br />
          [TODO: Country]
        </p>
      </section>

      <section className="space-y-2">
        <h2>Contact</h2>
        <p>
          Email: <strong>[TODO: Contact email]</strong>
        </p>
      </section>

      <section className="space-y-2">
        <h2>VAT identification number</h2>
        <p>
          VAT ID pursuant to § 27a of the German VAT Act (UStG), if applicable:{" "}
          <strong>[TODO: USt-IdNr. or “not applicable”]</strong>
        </p>
      </section>

      <section className="space-y-2">
        <h2>Responsible for content</h2>
        <p>
          Responsible for journalistic/editorial content pursuant to § 18 Abs. 2
          MStV, if applicable: <strong>[TODO: Name and address]</strong>
        </p>
      </section>

      <section className="space-y-2">
        <h2>Third-party media</h2>
        <p>
          Web-SyncPlay is a synchronization service. Playlist items are typically
          loaded from external sources chosen by room users (for example video
          platforms or direct media URLs). We do not create, curate, or control
          that third-party media. Liability for external information is governed
          by §§ 7–10 DDG: we are not obligated to monitor transmitted or stored
          third-party information, or to investigate circumstances indicating
          illegal activity. Obligations to remove or block information under
          general law remain unaffected once we become aware of a specific
          infringement.
        </p>
      </section>

      <section className="space-y-2">
        <h2>Dispute resolution</h2>
        <p>
          The European Commission provides a platform for online dispute
          resolution (ODR):{" "}
          <a
            href="https://ec.europa.eu/consumers/odr"
            target="_blank"
            rel="noreferrer noopener"
            className="text-foreground underline underline-offset-4"
          >
            https://ec.europa.eu/consumers/odr
          </a>
          . We are neither obligated nor willing to participate in dispute
          resolution proceedings before a consumer arbitration board.
        </p>
      </section>
    </LegalPage>
  )
}
