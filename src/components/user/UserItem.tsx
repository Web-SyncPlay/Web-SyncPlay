"use client";

import { useEffect, useRef, useState } from "react";
import { type UserState } from "../../lib/types";
import { secondsToTime } from "../../lib/utils";
import classNames from "classnames";
import InputText from "../input/InputText";
import Image from "next/image";
import { Pause, Play } from "lucide-react";

export default function UserItem({
  user,
  ownerId,
  socketId,
  updateName,
}: {
  user: UserState;
  ownerId: string;
  socketId: string;
  updateName: (name: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [name, _setName] = useState(user.name || "");
  const nameRef = useRef(name);
  const setName = (newName: string) => {
    _setName(newName);
    nameRef.current = newName;
  };

  useEffect(() => {
    setName(user.name || "");
  }, [user.name]);

  return (
    <div
      className={classNames(
        "rounded border-l-4",
        "bg-dark-900 hover:bg-dark-800 flex flex-row",
        socketId == user.uid
          ? "border-primary-900 hover:border-primary-800"
          : "border-dark-900 hover:border-dark-600",
      )}
    >
      {ownerId == user.uid && (
        <div
          className={"absolute -ml-4 -mt-4 inline-flex cursor-help p-2"}
          data-tooltip-content={"Owner of the lobby"}
        >
          <Play className={"text-primary-700 size-5"} />
        </div>
      )}
      <div className={"aspect-square shrink-0"}>
        <Image
          width={64}
          height={64}
          src={"https://api.dicebear.com/7.x/pixel-art/png?seed=" + user.uid}
          alt={"Generated profile picture of " + user.name}
        />
      </div>
      <div
        className={"grow p-2 pl-1"}
        onMouseEnter={() => {
          if (user.uid === socketId) {
            setEdit(true);
          }
        }}
        onMouseLeave={() => {
          if (user.uid === socketId) {
            setEdit(false);
          }
        }}
      >
        {edit ? (
          <InputText
            className={"h-full grow"}
            value={name}
            onChange={updateName}
            placeholder={"Change your name"}
          />
        ) : (
          <>
            <div className={"flex flex-row gap-1 truncate"}>{user.name}</div>
            <div className={"flex flex-row items-center gap-1"}>
              {user.player.paused ? (
                <Pause className={"size-3"} />
              ) : (
                <Play className={"size-3"} />
              )}
              {secondsToTime(user.player.progress)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
