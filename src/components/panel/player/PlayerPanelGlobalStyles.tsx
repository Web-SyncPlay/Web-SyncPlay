/** Guest / unmute / remote-seek chrome rules for the player shell. */
export function PlayerPanelGlobalStyles() {
  return (
    <style jsx global>{`
      /*
       * Room shell may be wider/shorter than 16:9 (full-width stage). Drop
       * Vidstack's aspect lock so the player chrome fills the shell; media
       * letterboxes/pillarboxes and stays centered on the black background.
       */
      [data-media-player][data-view-type="video"] {
        aspect-ratio: auto;
        width: 100%;
        height: 100%;
      }

      [data-media-provider] video {
        width: 100%;
        height: 100%;
        aspect-ratio: auto;
        object-fit: contain;
        object-position: center;
      }

      /*
       * Vidstack sizes youtube embeds at height: 1000% (centered, overflow
       * clipped) so native YT chrome falls outside a 16:9 frame. That works for
       * landscape, but portrait / Shorts are width-limited inside the tall
       * iframe — only ~1/3 of the picture stays visible. Embeds already use
       * controls=0; match the provider box instead.
       */
      iframe.vds-youtube[data-no-controls] {
        width: 100%;
        height: 100%;
      }

      .tap-to-unmute {
        transition: bottom 0.2s ease;
      }

      /* Only show while the player chrome is visible (same cadence as controls). */
      .guest-view-hint {
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      :has(.vds-controls[data-visible]):not(:has(.remote-seek-controls-hidden))
        > .guest-view-hint {
        opacity: 1;
      }

      /* Rise above the control bar + progress slider while they are visible. */
      :has(.vds-controls[data-visible]) > .tap-to-unmute {
        bottom: 6.5rem;
      }

      :has(.vds-video-layout[data-sm] .vds-controls[data-visible])
        > .tap-to-unmute {
        bottom: 7.25rem;
      }

      .remote-seek-controls-hidden .vds-controls {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* Hide spinner during post-play / post-canplay waiting grace. */
      .suppress-buffering-ui .vds-buffering-indicator {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* Gestures stay blocked for guests (tap-to-seek / click-to-play). */
      .guest-controls-guard .vds-gesture {
        pointer-events: none !important;
      }

      /* Room-synced transport stays host/moderator-only.
       * Local chrome (mute/volume/captions/settings/fullscreen) uses Vidstack's
       * normal pointer-events — do not blanket-disable .vds-controls. */
      .guest-controls-guard .vds-controls .vds-time-slider,
      .guest-controls-guard .vds-controls .vds-play-button,
      .guest-controls-guard .vds-controls .vds-seek-button,
      .guest-controls-guard .vds-controls .vds-playback-rate-slider,
      .guest-controls-guard .vds-controls .vds-playback-rate-radio-group,
      .guest-controls-guard .vds-controls .vds-loop-button,
      .guest-controls-guard .vds-controls [data-media-control="time-slider"],
      .guest-controls-guard .vds-controls [data-media-control="play-button"],
      .guest-controls-guard
        .vds-controls
        [data-media-control="seek-backward-button"],
      .guest-controls-guard
        .vds-controls
        [data-media-control="seek-forward-button"],
      .guest-controls-guard
        .vds-controls
        [data-media-control="playback-rate-slider"],
      .guest-controls-guard
        .vds-controls
        [data-media-control="playback-rate-menu"],
      .guest-controls-guard .vds-controls [aria-label*="playback speed" i],
      .guest-controls-guard .vds-controls [aria-label*="speed" i],
      .guest-controls-guard .vds-controls [aria-label*="loop" i] {
        display: none !important;
      }
    `}</style>
  )
}
