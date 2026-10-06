import { LegalPage } from "@/components/layout/LegalPage"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy | Web-SyncPlay",
  description:
    "How the web-syncplay.de instance processes data (hobby project, short retention).",
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      description="Short notice for the free hobby instance at https://web-syncplay.de (Art. 13 GDPR). No accounts, no ads, no analytics."
    >
      <section className="space-y-2">
        <h2>Who is responsible?</h2>
        <p>
          For the public instance{" "}
          <a
            href="https://web-syncplay.de"
            className="text-foreground underline underline-offset-4"
          >
            https://web-syncplay.de
          </a>
          :{" "}
          <a
            href="https://github.com/Yasamato"
            target="_blank"
            rel="noreferrer noopener"
            className="text-foreground underline underline-offset-4"
          >
            github.com/Yasamato
          </a>
          .
        </p>
        <p>
          If you self-host Web-SyncPlay, the operator of that instance is the
          controller — not us.
        </p>
      </section>

      <section className="space-y-2">
        <h2>What we process (and why)</h2>
        <p>
          Processing is limited to running sync rooms (Art. 6(1)(f) GDPR —
          legitimate interest in offering a free hobby service) and keeping the
          service stable (rate limits / abuse protection).
        </p>
        <ul>
          <li>
            Temporary participant identity (ID, encrypted secret, display name,
            avatar style) in your browser; server stores a hash of the secret
            with room state
          </li>
          <li>
            Room data: playlist metadata/URLs, playback state, roles, optional
            join password, short in-room activity log
          </li>
          <li>
            Connection data (e.g. IP) via normal HTTP/WebSocket handling
          </li>
          <li>Player preferences in localStorage (volume/mute)</li>
          <li>
            Short-lived rate-limit counters (~60 seconds) for DDoS/abuse
            protection only
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>How long</h2>
        <ul>
          <li>
            <strong>Room state</strong> (including activity log): Redis/Valkey
            TTL of <strong>1 hour</strong> while inactive; log entries older
            than 1 hour are pruned even if the room stays busy. No separate
            long-term log archive
          </li>
          <li>
            <strong>Rate limits:</strong> ~60-second windows, then gone
          </li>
          <li>
            <strong>Browser storage:</strong> until you clear site data
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>Local media</h2>
        <p>
          Files you share from your device are <strong>not uploaded</strong> as
          a stored library. They stay on the providing browser; we only relay
          bytes to other viewers and may keep short-lived metadata (~1 hour) and
          an ephemeral relay cache (~2 minutes).
        </p>
      </section>

      <section className="space-y-2">
        <h2>Who else sees data</h2>
        <ul>
          <li>
            Other people in the same room (names, presence, playlist/playback)
          </li>
          <li>
            Upstream media sites when someone adds a remote URL (their own
            policies apply)
          </li>
        </ul>
        <p>
          Avatars are generated in your browser (bundled{" "}
          <a
            href="https://www.dicebear.com"
            target="_blank"
            rel="noreferrer noopener"
            className="text-foreground underline underline-offset-4"
          >
            Dicebear
          </a>
          ). No marketing cookies or analytics. Essential localStorage only — no
          cookie banner.
        </p>
      </section>

      <section className="space-y-2">
        <h2>Your rights</h2>
        <p>
          You may request access, correction, deletion, restriction, or object
          to legitimate-interest processing, and complain to a data protection
          authority. In practice, clearing browser data or letting a room expire
          removes most data. Contact:{" "}
          <a
            href="https://github.com/Yasamato"
            target="_blank"
            rel="noreferrer noopener"
            className="text-foreground underline underline-offset-4"
          >
            github.com/Yasamato
          </a>
          .
        </p>
      </section>
    </LegalPage>
  )
}
