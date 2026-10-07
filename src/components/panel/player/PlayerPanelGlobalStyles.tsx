/** Guest / unmute / remote-seek chrome rules for the player shell. */
export function PlayerPanelGlobalStyles() {
  return (
    <style jsx global>{`
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

      .guest-controls-guard .vds-controls,
      .guest-controls-guard .vds-gesture {
        pointer-events: none !important;
      }

      /* Local-only: volume, captions toggle, and settings (quality/audio/CC). */
      .guest-controls-guard .vds-controls .vds-mute-button,
      .guest-controls-guard .vds-controls .vds-volume-slider,
      .guest-controls-guard .vds-controls .vds-volume-popup,
      .guest-controls-guard .vds-controls .vds-volume-group,
      .guest-controls-guard .vds-controls .vds-caption-button,
      .guest-controls-guard .vds-controls .vds-menu-button,
      .guest-controls-guard .vds-controls [data-media-control="mute-button"],
      .guest-controls-guard
        .vds-controls
        [data-media-control="volume-slider"],
      .guest-controls-guard .vds-controls [data-media-control="volume-popup"],
      .guest-controls-guard .vds-controls [data-media-control="volume-group"],
      .guest-controls-guard
        .vds-controls
        [data-media-control="caption-button"],
      .guest-controls-guard .vds-controls [data-media-control="settings"],
      .guest-controls-guard
        .vds-controls
        [data-media-control="settings-menu"],
      .guest-controls-guard .vds-controls [aria-label*="settings" i],
      .guest-controls-guard .vds-controls [aria-label*="captions" i],
      .guest-controls-guard .vds-controls [aria-label*="subtitles" i] {
        pointer-events: auto !important;
      }

      /* Room-synced transport stays host/moderator-only. */
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
