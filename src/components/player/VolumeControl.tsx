import ControlButton from "../input/ControlButton";
import InputSlider from "../input/InputSlider";
import { Volume, Volume1, Volume2, VolumeX } from "lucide-react";

export default function VolumeControl({
  muted,
  setMuted,
  volume,
  setVolume,
  interaction,
}: {
  muted: boolean;
  setMuted: (muted: boolean) => void;
  volume: number;
  setVolume: (volume: number) => void;
  interaction: (touch: boolean | null) => void;
}) {
  let sound;
  if (muted) {
    sound = <VolumeX />;
  } else if (volume < 0.3) {
    sound = <Volume />;
  } else if (volume < 0.7) {
    sound = <Volume1 />;
  } else {
    sound = <Volume2 />;
  }

  return (
    <div className={"flex flex-row items-center"}>
      <ControlButton
        tooltip={muted ? "Unmute" : "Mute"}
        onClick={() => {
          setMuted(!muted);
        }}
        interaction={interaction}
      >
        {sound}
      </ControlButton>
      <InputSlider
        value={muted ? 0 : volume}
        onChange={(newVolume) => {
          if (muted) {
            setMuted(false);
          }
          setVolume(newVolume);
          interaction(null);
        }}
        className={"hide-below-sm"}
      />
    </div>
  );
}
