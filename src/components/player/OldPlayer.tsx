"use client";

import { useEffect, useRef, useState } from "react";
import Controls from "./Controls";
import {
  FullScreen,
  type FullScreenProps,
  useFullScreenHandle,
} from "react-full-screen";
import ReactPlayer from "react-player";
import type { MediaOption, Subtitle } from "~/lib/types";
import ConnectingAlert from "../alert/ConnectingAlert";
import { getTargetTime, isSync } from "~/lib/utils";
import BufferAlert from "~/components/alert/BufferAlert";
import AutoplayAlert from "../alert/AutoplayAlert";
import { useController } from "~/lib/hooks/useController";

export interface PlayerProps {
  roomId: string;
  fullHeight?: boolean;
}

let seeking = false;

export default function OldPlayer({ roomId, fullHeight }: PlayerProps) {
  const {
    connected,
    deltaServerTime,
    playing,
    paused,
    progress: targetProgress,
    playbackRate,
    loop,
    lastSync,
    remote,
  } = useController(roomId);

  // updateX is never allowed to be called outside the _setX functions
  // _setX should not be called directly, but set via message from the server
  // setX are the normal plain state hooks
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(true);
  const [progress, _setProgress] = useState(0);
  const setProgress = (newProgress: number) => {
    remote.setProgress(newProgress);
    _setProgress(newProgress);
  };

  const [duration, setDuration] = useState(0);
  const [currentSrc, setCurrentSrc] = useState<MediaOption>(playing.src[0]!);
  const [currentSub, setCurrentSub] = useState<Subtitle | null>(
    playing.sub[0] ?? null,
  );

  const [error, setError] = useState<null | object>(null);
  const [ready, _setReady] = useState(false);
  const readyRef = useRef(ready);
  const setReady = (newReady: boolean) => {
    _setReady(newReady);
    readyRef.current = newReady;
  };
  const [seeked, _setSeeked] = useState(false);
  const seekedRef = useRef(seeked);
  const setSeeked = (newSeeked: boolean) => {
    _setSeeked(newSeeked);
    seekedRef.current = newSeeked;
  };
  const [buffering, setBuffering] = useState(true);
  const [unmuted, setUnmuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenHandle = useFullScreenHandle();
  const player = useRef<ReactPlayer>(null);

  useEffect(() => {
    if (!muted && !unmuted) {
      setUnmuted(true);
    }
  }, [muted, unmuted]);

  useEffect(() => {
    if (
      !readyRef.current ||
      player.current === null ||
      typeof player.current === "undefined"
    )
      return;
    if (
      !isSync(
        player.current.getCurrentTime(),
        targetProgress,
        lastSync - deltaServerTime,
        paused,
        playbackRate,
      ) &&
      !seeking
    ) {
      const t = getTargetTime(
        targetProgress,
        lastSync - deltaServerTime,
        paused,
        playbackRate,
      );
      console.log("Not in sync, seeking to", t);
      player.current.seekTo(t, "seconds");
    }
  }, [
    progress,
    targetProgress,
    lastSync,
    deltaServerTime,
    paused,
    ready,
    playbackRate,
  ]);

  const FullScreenWithChildren = FullScreen as React.FC<
    React.PropsWithChildren<FullScreenProps>
  >;
  return (
    <FullScreenWithChildren
      className={"relative flex grow select-none"}
      handle={fullscreenHandle}
      onChange={(state, _) => {
        if (fullscreen !== state) {
          setFullscreen(state);
        }
      }}
    >
      <ReactPlayer
        style={{
          maxHeight: fullscreen || fullHeight ? "100vh" : "calc(100vh - 210px)",
        }}
        ref={player}
        width={"100%"}
        height={fullscreen || fullHeight ? "100vh" : "calc((9 / 16) * 100vw)"}
        config={{
          youtube: {
            playerVars: {
              disablekb: 1,
              modestbranding: 1,
              origin: window.location.host,
            },
          },
          file: {
            hlsVersion: "1.1.3",
            dashVersion: "4.2.1",
            flvVersion: "1.6.2",
          },
        }}
        url={currentSrc.url}
        pip={false}
        playing={!paused}
        controls={false}
        loop={loop}
        playbackRate={playbackRate}
        volume={volume}
        muted={muted}
        onReady={() => {
          console.log("React-Player is ready");
          setReady(true);
          setBuffering(false);
          // need "long" timeout for yt to be ready
          setTimeout(() => {
            const internalPlayer = player.current?.getInternalPlayer();
            console.log("Internal player:", player);
            if (internalPlayer?.unloadModule) {
              console.log("Unloading cc of youtube player");
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call
              internalPlayer.unloadModule("cc"); // Works for AS3 ignored by html5
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call
              internalPlayer.unloadModule("captions"); // Works for html5 ignored by AS3
            }
          }, 1000);
        }}
        onPlay={() => {
          console.log("player started to play");
          if (paused) {
            const internalPlayer = player.current?.getInternalPlayer();
            console.warn(
              "Started to play despite being paused",
              internalPlayer,
            );
            if (typeof internalPlayer !== "undefined") {
              if (
                "pause" in internalPlayer &&
                typeof internalPlayer.pause === "function"
              ) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                internalPlayer.pause();
              }
              if (
                "pauseVideo" in internalPlayer &&
                typeof internalPlayer.pauseVideo === "function"
              ) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                internalPlayer.pauseVideo();
              }
            }
          }
        }}
        onPause={() => {
          console.log("player paused");
          if (!paused) {
            const internalPlayer = player.current?.getInternalPlayer();
            console.warn(
              "Started to pause despite being not paused",
              internalPlayer,
            );
            if (typeof internalPlayer !== "undefined") {
              if (
                "play" in internalPlayer &&
                typeof internalPlayer.play === "function"
              ) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                internalPlayer.play();
              }
              if (
                "playVideo" in internalPlayer &&
                typeof internalPlayer.playVideo === "function"
              ) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                internalPlayer.playVideo();
              }
            }
          }
        }}
        onBuffer={() => setBuffering(true)}
        onBufferEnd={() => setBuffering(false)}
        onEnded={remote.playEnded}
        onError={(error) => {
          const e = error as object;
          console.error("playback error", e);
          if ("target" in e && "type" in e && e.type === "error") {
            console.log("Trying to get video url via yt-dlp...");
            fetch("/api/source", { method: "POST", body: currentSrc.url })
              .then((res) => {
                if (res.status === 200) {
                  return res.json();
                }
                return res.text();
              })
              .then((data) => {
                console.log("Received data", data);
                if (typeof data === "string") {
                  throw new Error(data);
                }
                const result = data as { stdout: string; stderr: string };
                if (result.stderr) {
                  throw new Error(result.stderr);
                }

                const videoSrc = result.stdout
                  .split("\n")
                  .filter((v: string) => v !== "");
                setCurrentSrc({
                  url: videoSrc[0]!,
                  resolution: "",
                });
              })
              .catch((error) => {
                console.error("Failed to get video url", error);
              });
            setError(e);
          }
        }}
        onProgress={({ playedSeconds }) => {
          if (!ready) {
            console.warn(
              "React-Player did not report it being ready, but already playing",
            );
            // sometimes onReady doesn't fire, but if there's playback...
            setReady(true);
          }
          if (!seeking || !seeked) {
            setProgress(playedSeconds);
          }
        }}
        onDuration={setDuration}
      />

      <Controls
        roomId={roomId}
        setCurrentSrc={setCurrentSrc}
        setCurrentSub={setCurrentSub}
        setVolume={setVolume}
        setMuted={setMuted}
        setProgress={(newProgress) => {
          setSeeked(true);
          remote.setProgress(newProgress);
        }}
        setFullscreen={async (newFullscreen) => {
          if (fullscreenHandle.active !== newFullscreen) {
            if (newFullscreen) {
              await fullscreenHandle.enter();
            } else {
              await fullscreenHandle.exit();
            }
          }
          setFullscreen(newFullscreen);
        }}
        currentSrc={currentSrc}
        currentSub={currentSub}
        volume={volume}
        muted={muted}
        progress={progress}
        fullscreen={fullscreen}
        duration={duration}
        setSeeking={(newSeeking) => {
          seeking = newSeeking;
        }}
        error={error}
      />

      <div className={"absolute left-1 top-1 flex flex-col gap-1 p-1"}>
        {!connected && <ConnectingAlert canClose={false} />}
        {buffering && <BufferAlert canClose={false} />}
        {!unmuted && (
          <AutoplayAlert
            onClick={() => {
              setUnmuted(true);
              setMuted(false);
            }}
          />
        )}
      </div>
    </FullScreenWithChildren>
  );
}
