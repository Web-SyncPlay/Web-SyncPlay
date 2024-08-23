"use client";

import { useState } from "react";
import Button from "../action/Button";
import InputText from "../input/InputText";
import { useRouter } from "next/navigation";

export function CreateRoom() {
  const router = useRouter();
  const [room, setRoom] = useState("");

  return (
    <div className={"flex justify-center self-center"}>
      <form
        className={
          "bg-dark-900 m-8 flex flex-col justify-center gap-4 rounded p-3 shadow"
        }
        onSubmit={(e) => {
          e.preventDefault();

          if (room.length >= 4) {
            router.push("/room/" + room);
          }
        }}
      >
        <h1 className={"text-2xl"}>Got invited?</h1>
        <InputText
          value={room}
          placeholder={"Enter a room ID"}
          onChange={(value) =>
            setRoom(value.toLowerCase().replace(/[^a-z]/g, ""))
          }
        />
        <div className={"flex justify-end gap-2"}>
          <Button
            tooltip={"Create a new personal room"}
            className={"p-2"}
            actionClasses={
              "bg-primary-900 hover:bg-primary-800 active:bg-primary-700"
            }
            onClick={() => {
              fetch("/api/generate")
                .then((r) => r.json())
                .then(({ roomId }) => {
                  console.log("Generated new roomId:", roomId);
                  if (
                    typeof roomId === "string" &&
                    roomId.length >= 4 &&
                    /^[a-z]{4,}$/.exec(roomId)
                  ) {
                    router.push("/room/" + roomId);
                  } else {
                    throw Error("Invalid roomId generated: " + roomId);
                  }
                })
                .catch((error) => {
                  console.error("Failed to generate new roomId", error);
                });
            }}
          >
            Generate room
          </Button>
          <Button
            tooltip={room.length < 4 ? "Invalid room id" : "Join room"}
            className={"p-2"}
            actionClasses={
              room.length >= 4
                ? "bg-primary-900 hover:bg-primary-800 active:bg-primary-700"
                : "bg-dark-700 hover:bg-dark-600 active:bg-red-700 cursor-not-allowed"
            }
            disabled={room.length < 4}
            type={"submit"}
          >
            Join room
          </Button>
        </div>
      </form>
    </div>
  );
}
