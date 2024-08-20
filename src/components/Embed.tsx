"use client";

import { type FC, useEffect, useState } from "react";
import OldPlayer from "./player/OldPlayer";
import {
  type ClientToServerEvents,
  createClientSocket,
  type ServerToClientEvents,
} from "../lib/socket";
import { type Socket } from "socket.io-client";
import ConnectingAlert from "./alert/ConnectingAlert";
import { Tooltip } from "react-tooltip";

interface Props {
  id: string;
}

let connecting = false;

const Embed: FC<Props> = ({ id }) => {
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);

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
    <>
      <OldPlayer roomId={id} socket={socket} fullHeight={true} />
      <Tooltip
        style={{
          backgroundColor: "var(--dark-700)",
        }}
      />
    </>
  );
};

export default Embed;
