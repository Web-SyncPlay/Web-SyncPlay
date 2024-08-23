"use client";

import { Tooltip } from "react-tooltip";
import OldPlayer from "./player/OldPlayer";

export default function Embed({ id }: { id: string }) {
  return (
    <>
      <OldPlayer roomId={id} fullHeight={true} />
      <Tooltip
        style={{
          backgroundColor: "var(--dark-700)",
        }}
      />
    </>
  );
}
