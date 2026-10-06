import { LegalPage } from "@/components/layout/LegalPage"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Use | Web-SyncPlay",
  description: "Terms of use for the Web-SyncPlay synchronization service.",
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      description="Terms governing use of the Web-SyncPlay service (AGB / Nutzungsbedingungen)."
    >
      <section className="space-y-2">
        <h2>1. Operator</h2>
        <p>
          These terms apply to the use of Web-SyncPlay as offered by{" "}
          <strong>[TODO: Full legal name]</strong> (“we”, “us”). Contact:{" "}
          <strong>[TODO: Contact email]</strong>.
        </p>
      </section>

      <section className="space-y-2">
        <h2>2. Service description</h2>
        <p>
          Web-SyncPlay provides tools to create rooms and synchronize playback
          of media among participants. The service is account-less: joining a
          room creates a temporary participant session. Features may change,
          be limited, or be discontinued at any time.
        </p>
      </section>

      <section className="space-y-2">
        <h2>3. No contractual guarantee of availability</h2>
        <p>
          The service is provided free of charge and “as is”. We do not
          guarantee uninterrupted or error-free operation, specific sync
          accuracy, or continued availability of any feature.
        </p>
      </section>

      <section className="space-y-2">
        <h2>4. Acceptable use</h2>
        <p>You agree not to use the service to:</p>
        <ul>
          <li>Violate applicable law or third-party rights</li>
          <li>
            Distribute or facilitate access to illegal content, malware, or
            unauthorized copyrighted material
          </li>
          <li>
            Attack, overload, scrape abusively, or disrupt the service or other
            users
          </li>
          <li>
            Circumvent access controls (including room passwords or control
            tokens) without authorization
          </li>
        </ul>
        <p>
          We may restrict or terminate access to rooms or the service if we
          believe these terms are violated.
        </p>
      </section>

      <section className="space-y-2">
        <h2>5. Third-party media and local files</h2>
        <p>
          Users choose which media URLs or local files to share in a room. We
          do not host a general media library of our own. You are solely
          responsible for ensuring you have the rights to play, share, or
          stream any media you add. Upstream platforms and file hosts remain
          subject to their own terms. When local files are shared, bytes are
          relayed for room participants while the providing browser tab remains
          available; we do not permanently store those files as a media library.
        </p>
      </section>

      <section className="space-y-2">
        <h2>6. Rooms, passwords, and roles</h2>
        <p>
          Room names/IDs may be guessable. Optional join passwords and roles
          improve access control but are not a substitute for treating sensitive
          content carefully. Do not share control embed URLs with people who
          should not control playback.
        </p>
      </section>

      <section className="space-y-2">
        <h2>7. Liability</h2>
        <p>
          We are liable without limitation for intent and gross negligence, and
          for injury to life, body, or health. For slight negligence we are
          liable only for breach of essential obligations (cardinal duties),
          limited to typical foreseeable damage, except where mandatory law
          provides otherwise. Liability for third-party media chosen by users is
          excluded to the extent permitted by §§ 7–10 DDG and applicable law.
        </p>
      </section>

      <section className="space-y-2">
        <h2>8. Open source</h2>
        <p>
          The Web-SyncPlay software may also be self-hosted by others under its
          open-source license. These terms apply only to the instance operated
          by us. Self-hosted deployments are the responsibility of their
          operators.
        </p>
      </section>

      <section className="space-y-2">
        <h2>9. Changes</h2>
        <p>
          We may update these terms. The version published on this page applies
          to continued use of the service after publication.
        </p>
        <p>
          Last updated: <strong>[TODO: Date]</strong>
        </p>
      </section>

      <section className="space-y-2">
        <h2>10. Governing law</h2>
        <p>
          German law applies, excluding conflict-of-law rules. Mandatory
          consumer protection rules of your country of residence remain
          unaffected where applicable.
        </p>
      </section>
    </LegalPage>
  )
}
