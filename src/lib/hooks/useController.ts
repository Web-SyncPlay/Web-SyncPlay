"use client";

import { type Socket } from "socket.io-client";
import { useEffect, useRef, useState } from "react";
import {
  type ClientToServerEvents,
  createClientSocket,
  type ServerToClientEvents,
} from "../socket";
import type {
  MediaElement,
  PlayerState,
  Playlist,
  UserState,
  RoomState,
  TargetState,
} from "../types";
import { env } from "~/env";

const initialPlaylist: Playlist = {
  items: [],
  currentIndex: -1,
};
const initialPlaying: MediaElement = {
  sub: [],
  src: [
    {
      url: env.NEXT_PUBLIC_DEFAULT_SRC,
      resolution: "",
    },
  ],
};
const initialTargetState: TargetState = {
  playlist: initialPlaylist,
  playing: initialPlaying,
  paused: false,
  progress: 0,
  playbackRate: 1,
  loop: false,
  lastSync: -1,
};

export function useController(roomId: string) {
  const socket = useRef<Socket<ServerToClientEvents, ClientToServerEvents>>();
  const [connected, setConnected] = useState(false);
  // delta in server to client time in seconds
  const [deltaServerTime, setDeltaServerTime] = useState(0);

  const [room, setRoom] = useState<RoomState>({
    serverTime: -1,
    id: roomId,
    ownerId: "",
    users: [],
    targetState: initialTargetState,
    commandHistory: [],
  });
  const [playlist, setPlaylist] = useState<Playlist>(initialPlaylist);
  const [users, setUsers] = useState<UserState[]>([]);
  const [owner, setOwner] = useState("");

  // target states
  const [playing, setPlaying] = useState<MediaElement>(
    initialTargetState.playing,
  );
  const [paused, setPaused] = useState(initialTargetState.paused);
  const [progress, setProgress] = useState(initialTargetState.progress);
  const [playbackRate, setPlaybackRate] = useState(
    initialTargetState.playbackRate,
  );
  const [loop, setLoop] = useState(initialTargetState.loop);
  const [lastSync, setLastSync] = useState(initialTargetState.lastSync);

  useEffect(() => {
    if (connected) {
      socket.current?.emit("fetch");
    }
  }, [connected]);

  useEffect(() => {
    const websocket = createClientSocket(roomId);
    socket.current = websocket;

    websocket.on("connect", () => {
      setConnected(true);
    });
    websocket.on("disconnect", () => {
      setConnected(false);
    });
    setConnected(websocket.connected);

    websocket.on("update", (newRoom: RoomState) => {
      setRoom(newRoom);
      setDeltaServerTime((newRoom.serverTime - new Date().getTime()) / 1000);
      setPlaylist(newRoom.targetState.playlist);
      setUsers(newRoom.users);
      setOwner(newRoom.ownerId);

      // target state
      setPlaying(newRoom.targetState.playing);
      setPaused(newRoom.targetState.paused);
      setProgress(newRoom.targetState.progress);
      setPlaybackRate(newRoom.targetState.playbackRate);
      setLoop(newRoom.targetState.loop);
      setLastSync(newRoom.targetState.lastSync);
    });
    websocket.on("playlistUpdate", (newPlaylist: Playlist) => {
      setPlaylist(newPlaylist);
    });
    websocket.on("userUpdates", (users: UserState[]) => {
      setUsers(users);
    });

    return () => {
      websocket.close();
    };
  }, [roomId]);

  const remote: ClientToServerEvents = {
    playItemFromPlaylist: (index: number) => {
      if (
        typeof playlist.items[index] === "undefined" ||
        playlist.items[index] === null
      ) {
        console.error("Impossible to play", index, "from", playlist);
        return;
      }
      socket.current?.emit("playItemFromPlaylist", index);
    },
    updatePlaylist: (newPlaylist: Playlist) => {
      socket.current?.emit("updatePlaylist", newPlaylist);
      setPlaylist(newPlaylist);
    },
    updatePlayer: (player: PlayerState) => {
      socket.current?.emit("updatePlayer", player);
    },
    updatePlaying: (newPlaying: MediaElement) => {
      socket.current?.emit("updatePlaying", newPlaying);
    },
    updateUser: (user: UserState) => {
      socket.current?.emit("updateUser", user);
    },
    setPaused: (newPaused: boolean) => {
      socket.current?.emit("setPaused", newPaused);
    },
    setLoop: (newLoop: boolean) => {
      socket.current?.emit("setLoop", newLoop);
    },
    setProgress: (newProgress: number) => {
      socket.current?.emit("setProgress", newProgress);
    },
    setPlaybackRate: (newPlaybackRate: number) => {
      socket.current?.emit("setPlaybackRate", newPlaybackRate);
    },
    seek: (newProgress: number) => {
      socket.current?.emit("seek", newProgress);
      setProgress(newProgress);
    },
    playUrl: (src: string) => {
      socket.current?.emit("playUrl", src);
    },
    playAgain: () => socket.current?.emit("playAgain"),
    playEnded: () => socket.current?.emit("playEnded"),
    fetch: () => socket.current?.emit("fetch"),
    error: () => socket.current?.emit("error"),
  };

  return {
    socket,
    connected,
    deltaServerTime,
    room,
    playing,
    paused,
    progress,
    playbackRate,
    loop,
    lastSync,
    playlist,
    users,
    owner,
    remote,
  };
}
