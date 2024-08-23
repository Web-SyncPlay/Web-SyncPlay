"use client";

import { useState } from "react";
import OldPlayer from "./player/OldPlayer";
import Button from "./action/Button";
import PlaylistMenu from "./playlist/PlaylistMenu";
import InputUrl from "./input/InputUrl";
import UserList from "./user/UserList";
import { Repeat } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { useController } from "~/lib/hooks/useController";
import ConnectingAlert from "./alert/ConnectingAlert";

export default function Room({ id }: { id: string }) {
  const { socket, connected, remote } = useController(id);
  const [url, setUrl] = useState("");

  if (!connected || typeof socket.current === "undefined") {
    return (
      <div className={"flex grow justify-center"}>
        <ConnectingAlert />
      </div>
    );
  }

  return (
    <div className={"flex grow flex-col gap-1 sm:flex-row"}>
      <div className={"grow"}>
        <OldPlayer roomId={id} />

        <div className={"flex flex-row gap-1 p-1"}>
          <Button
            tooltip={"Do a forced manual sync"}
            className={"flex flex-row items-center gap-1 p-2"}
            onClick={() => {
              console.log("Fetching update", socket.current?.id);
              remote.fetch();
            }}
          >
            <Repeat />
            <div className={"hidden-below-sm"}>Manual sync</div>
          </Button>
          <InputUrl
            className={"grow"}
            url={url}
            placeholder={"Play url now"}
            tooltip={"Play given url now"}
            onChange={setUrl}
            onSubmit={() => {
              console.log("Requesting", url, "now");
              remote.playUrl(url);
              setUrl("");
            }}
          >
            Play
          </InputUrl>
        </div>

        <UserList roomId={id} />
      </div>

      <PlaylistMenu roomId={id} />
      <Tooltip
        style={{
          backgroundColor: "var(--dark-700)",
        }}
      />
    </div>
  );
}
