import { LegalPage } from "@/components/layout/LegalPage"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy | Web-SyncPlay",
  description:
    "How Web-SyncPlay processes personal data when you use the service.",
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      description="Information pursuant to Art. 13 and 14 GDPR about how this service processes personal data."
    >
      <section className="space-y-2">
        <h2>1. Controller</h2>
        <p>
          The controller responsible for processing personal data is:
          <br />
          <strong>[TODO: Full legal name]</strong>
          <br />
          [TODO: Postal address]
          <br />
          Email: <strong>[TODO: Contact email]</strong>
        </p>
      </section>

      <section className="space-y-2">
        <h2>2. What this service does</h2>
        <p>
          Web-SyncPlay lets people create or join sync rooms to watch or listen
          to media together. There is no traditional user account. Participants
          are identified by a randomly generated identifier and optional display
          name stored in the browser and associated with the room session.
        </p>
      </section>

      <section className="space-y-2">
        <h2>3. Categories of data</h2>
        <ul>
          <li>
            <strong>Session identity:</strong> user ID and secret, display name
            (username), avatar style preference
          </li>
          <li>
            <strong>Room data:</strong> room ID, playlist metadata and media
            URLs you add, playback state, roles, optional join password
          </li>
          <li>
            <strong>Connection data:</strong> IP address and technical
            connection metadata when you connect via HTTP/WebSocket (processed by
            the hosting infrastructure and application server)
          </li>
          <li>
            <strong>Local preferences:</strong> e.g. player volume / mute state
            in your browser
          </li>
          <li>
            <strong>Operational logs:</strong> limited server-side action logs
            for room operations and abuse prevention
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>4. Purposes and legal bases</h2>
        <ul>
          <li>
            Providing rooms, realtime sync, and media playback — Art. 6(1)(b)
            GDPR (contract / requested service) or Art. 6(1)(f) (legitimate
            interest in operating the free service)
          </li>
          <li>
            Security, rate limiting, and abuse prevention — Art. 6(1)(f) GDPR
          </li>
          <li>
            Essential local storage required to keep your session and playback
            preferences — Art. 6(1)(f) GDPR; storage/access under TTDSG/TDDDG §
            25(2) (technically necessary)
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>5. Storage and retention</h2>
        <ul>
          <li>
            <strong>Browser (localStorage):</strong> session identity and player
            preferences remain until you clear site data or they are overwritten
          </li>
          <li>
            <strong>Server (Valkey/Redis):</strong> room state, identities, and
            related tokens are stored with a short TTL (approximately 1 hour of
            inactivity / configured room lifetime) and then expire
          </li>
          <li>
            <strong>Logs:</strong> retained only as long as needed for
            operations and security, then deleted or anonymized
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>6. Recipients / third parties</h2>
        <ul>
          <li>
            <strong>Hosting / infrastructure provider:</strong>{" "}
            [TODO: Name your hoster, e.g. VPS or cloud provider] processes
            connection data as a processor or under their own responsibility as
            infrastructure provider
          </li>
          <li>
            <strong>Other participants in your room:</strong> display name,
            avatar appearance, presence, and playlist/playback state are shared
            with others in the same room
          </li>
          <li>
            <strong>Upstream media hosts:</strong> when you add a remote media
            URL, your browser and/or our media proxy may request that URL from
            the third-party host (e.g. a video platform or file host). Those
            providers process the request under their own policies
          </li>
        </ul>
        <p>
          Avatars are generated locally in your browser (Dicebear libraries
          bundled with this app). No avatar request is sent to a third-party
          avatar CDN.
        </p>
      </section>

      <section className="space-y-2">
        <h2>7. Cookies and similar technologies</h2>
        <p>
          This service does not use marketing or analytics cookies. It uses
          essential browser storage (localStorage) for session identity and
          player preferences. No cookie consent banner is shown for these
          technically necessary functions. If non-essential trackers are added
          later, this policy and consent handling will be updated.
        </p>
      </section>

      <section className="space-y-2">
        <h2>8. International transfers</h2>
        <p>
          [TODO: Describe whether hosting or upstream media requests may involve
          transfers outside the EU/EEA and the safeguards used.]
        </p>
      </section>

      <section className="space-y-2">
        <h2>9. Your rights</h2>
        <p>
          Under the GDPR you may have the right to access, rectification,
          erasure, restriction, data portability, and to object to processing
          based on legitimate interests. You also have the right to lodge a
          complaint with a supervisory authority. Because the service is largely
          session-based with short server retention, many requests are fulfilled
          by clearing your browser storage or letting rooms expire.
        </p>
        <p>
          Contact: <strong>[TODO: Contact email]</strong>
        </p>
      </section>

      <section className="space-y-2">
        <h2>10. No obligation to provide data</h2>
        <p>
          You are not legally required to provide personal data. Without a
          working connection and a session identity, you cannot use sync rooms.
        </p>
      </section>

      <section className="space-y-2">
        <h2>11. Updates</h2>
        <p>
          We may update this privacy policy when the service or legal
          requirements change. The version published on this page applies.
        </p>
        <p>
          Last updated: <strong>[TODO: Date]</strong>
        </p>
      </section>
    </LegalPage>
  )
}
