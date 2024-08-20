"use client";

import { useEffect, useState } from "react";
import OldPlayer from "./player/OldPlayer";
import {
  type ClientToServerEvents,
  createClientSocket,
  type ServerToClientEvents,
} from "../lib/socket";
import Button from "./action/Button";
import { type Socket } from "socket.io-client";
import ConnectingAlert from "./alert/ConnectingAlert";
import PlaylistMenu from "./playlist/PlaylistMenu";
import InputUrl from "./input/InputUrl";
import UserList from "./user/UserList";
import { Repeat } from "lucide-react";
import { Tooltip } from "react-tooltip";

let connecting = false;

export default function Room({ id }: { id: string }) {
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    void fetch("/api/socketio").finally(() => {
      if (socket !== null) {
        setConnected(socket.connected);
      } else {
        const newSocket = createClientSocket(id);
        newSocket.on("connect", () => {
          setConnected(true);
        });
        setSocket(newSocket);
      }
    });

    return () => {
      if (socket !== null) {
        socket.disconnect();
      }
    };
  }, [id, socket]);

  const connectionCheck = () => {
    if (socket?.connected) {
      connecting = false;
      setConnected(true);
      return;
    }
    setTimeout(connectionCheck, 100);
  };

  if (!connected || socket === null) {
    if (!connecting) {
      connecting = true;
      connectionCheck();
    }
    return (
      <div className={"flex justify-center"}>
        <ConnectingAlert />
      </div>
    );
  }

  return (
    <div className={"flex flex-col gap-1 sm:flex-row"}>
      <div className={"grow"}>
        <OldPlayer roomId={id} socket={socket} />

        <div className={"flex flex-row gap-1 p-1"}>
          <Button
            tooltip={"Do a forced manual sync"}
            className={"flex flex-row items-center gap-1 p-2"}
            onClick={() => {
              console.log("Fetching update", socket?.id);
              socket?.emit("fetch");
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
              socket?.emit("playUrl", url);
              setUrl("");
            }}
          >
            Play
          </InputUrl>
        </div>

        <UserList socket={socket} />
      </div>

      <PlaylistMenu socket={socket} />
      <Tooltip
        style={{
          backgroundColor: "var(--dark-700)",
        }}
      />
    </div>
  );
}
