"use client";

import { type ReactNode, useState } from "react";
import type { MediaOption, Subtitle } from "~/lib/types";
import DropUp from "../action/DropUp";
import InputRadio from "../input/InputRadio";
import ControlButton from "../input/ControlButton";
import classNames from "classnames";
import Button from "../action/Button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Captions,
  ChevronLeft,
  ExternalLink,
  Repeat,
  Settings,
  Settings2,
  Share2,
  X,
} from "lucide-react";
import { useController } from "~/lib/hooks/useController";

interface Tab {
  icon: ReactNode;
  title: ReactNode;
  content: ReactNode;
}

export default function PlayerMenu({
  roomId,
  currentSrc,
  setCurrentSrc,
  currentSub,
  setCurrentSub,
  interaction,
  menuOpen,
  setMenuOpen,
}: {
  roomId: string;
  currentSrc: MediaOption;
  setCurrentSrc: (src: MediaOption) => void;
  currentSub: Subtitle | null;
  setCurrentSub: (sub: Subtitle) => void;
  interaction: (touch: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}) {
  const { playing, loop, playbackRate, remote } = useController(roomId);
  const [tab, setTab] = useState(-1);
  const router = useRouter();

  const tabs: Tab[] = [
    {
      icon: <Settings2 />,
      title: "Playback rate",
      content: (
        <InputRadio
          value={playbackRate.toString()}
          options={[
            "3",
            "2",
            "1.75",
            "1.5",
            "1.25",
            "1",
            "0.75",
            "0.5",
            "0.25",
          ]}
          setValue={(rate) => remote.setPlaybackRate(parseFloat(rate))}
          interaction={interaction}
        />
      ),
    },
    {
      icon: <Repeat />,
      title: "Loop",
      content: (
        <Button
          tooltip={"Click to toggle loop"}
          onClick={() => remote.setLoop(!loop)}
        >
          {loop ? "Disable loop" : "Enable loop"}
        </Button>
      ),
    },
    {
      icon: <Share2 />,
      title: "Open embed",
      content: (
        <div className="flex flex-col">
          <Button
            tooltip="Switch to full player"
            className="flex flex-row gap-1 p-2"
            onClick={() => {
              router.push("/room/" + roomId);
            }}
          >
            <ExternalLink />
            <span>Switch to full player</span>
          </Button>
          <Button
            tooltip="Switch to embed player"
            className="flex flex-row gap-1 p-2"
            onClick={() => {
              router.push("/embed/" + roomId);
            }}
          >
            <ExternalLink />
            <span>Switch to embed player</span>
          </Button>
          <Link
            href={"/room/" + roomId}
            target="_blank"
            className="flex flex-row gap-1 p-2"
          >
            <ExternalLink />
            <span>Open full player in new tab</span>
          </Link>
          <Link
            href={"/embed/" + roomId}
            target="_blank"
            className="flex flex-row gap-1 p-2"
          >
            <ExternalLink />
            <span>Open embed player in new tab</span>
          </Link>
        </div>
      ),
    },
  ];

  if (playing.src.length > 1) {
    tabs.push({
      icon: <Settings2 />,
      title: "Resolution",
      content: (
        <InputRadio
          value={currentSrc.resolution}
          options={playing.src.map((option) => option.resolution)}
          setValue={(resolution) => {
            const newSrc = playing.src.find(
              (src) => src.resolution === resolution,
            );
            if (newSrc) {
              setCurrentSrc(newSrc);
            } else {
              console.error(
                "Impossible resolution",
                resolution,
                "not found in",
                playing,
              );
            }
          }}
          interaction={interaction}
        />
      ),
    });
  }

  if (playing.sub.length > 1) {
    tabs.push({
      icon: <Captions />,
      title: "Subtitle",
      content: (
        <InputRadio
          value={currentSub?.lang ?? ""}
          options={playing.sub.map((sub) => sub.lang)}
          setValue={(lang) => {
            const newSub = playing.sub.find((sub) => sub.lang === lang);
            if (newSub) {
              setCurrentSub(newSub);
            } else {
              console.error("Impossible sub", newSub, "not found in", playing);
            }
          }}
          interaction={interaction}
        />
      ),
    });
  }

  const displayIcon = (icon: ReactNode, className = "") => {
    return <div className={classNames("w-8", className)}>{icon}</div>;
  };

  return (
    <DropUp
      tooltip={"settings"}
      className={"bg-dark-900/90 -left-[180px]"}
      open={menuOpen}
      menuChange={setMenuOpen}
      interaction={interaction}
      buttonContent={<Settings />}
    >
      <div className={"w-[240px]"}>
        <div className={"no-wrap flex flex-row items-center"}>
          {tab >= 0 && (
            <>
              <ControlButton
                tooltip={"Go back"}
                onClick={() => setTab(-1)}
                interaction={interaction}
              >
                <ChevronLeft />
              </ControlButton>
              {displayIcon(tabs[tab]?.icon, "ml-1")}
              <div className={"px-1"}>{tabs[tab]?.title}</div>
            </>
          )}
          <ControlButton
            tooltip={"Close menu"}
            className={"ml-auto"}
            onClick={() => setMenuOpen(false)}
            interaction={interaction}
          >
            <X />
          </ControlButton>
        </div>
        {tab < 0 &&
          tabs.map((t, index) => (
            <ControlButton
              tooltip={"Adjust " + t.title?.toString()}
              key={t.title?.toString() + "-" + index}
              onClick={() => setTab(index)}
              interaction={interaction}
              className={"flex flex-row items-center"}
            >
              {displayIcon(t.icon)}
              {t.title}
            </ControlButton>
          ))}
        {tab >= 0 && tabs[tab]?.content}
      </div>
    </DropUp>
  );
}
