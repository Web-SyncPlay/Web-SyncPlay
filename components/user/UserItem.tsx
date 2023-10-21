import { FC, useEffect, useRef, useState } from "react"
import { UserState } from "../../lib/types"
import { secondsToTime } from "../../lib/utils"
import IconPause from "../icon/IconPause"
import IconPlay from "../icon/IconPlay"
import classNames from "classnames"
import IconOwner from "../icon/IconOwner"
import InputText from "../input/InputText"
import Image from "next/image"

interface Props {
  user: UserState
  ownerId: string
  socketId: string
  updateName: (name: string) => void
}

const UserItem: FC<Props> = ({ user, ownerId, socketId, updateName }) => {
  const [edit, setEdit] = useState(false)
  const [name, _setName] = useState(user.name || "")
  const nameRef = useRef(name)
  const setName = (newName: string) => {
    _setName(newName)
    nameRef.current = newName
  }

  useEffect(() => {
    setName(user.name || "")
  }, [user.name])

  return (
    <div
      className={classNames(
        "rounded border-l-4",
        "flex flex-row bg-dark-900 hover:bg-dark-800",
        socketId == user.uid
          ? "border-primary-900 hover:border-primary-800"
          : "border-dark-900 hover:border-dark-600"
      )}
    >
      {ownerId == user.uid && (
        <div
          className={"absolute inline-flex -ml-4 -mt-4 p-2 cursor-help"}
          data-tooltip-content={"Owner of the lobby"}
        >
          <IconOwner className={"text-primary-700"} sizeClassName={"w-5 h-5"} />
        </div>
      )}
      <div className={"aspect-square shrink-0"}>
        <Image
          width={64}
          height={64}
          src={
            "https://api.dicebear.com/7.x/pixel-art/png?seed=" + user.uid
          }
          alt={"Generated profile picture of " + user.name}
        />
      </div>
      <div
        className={"p-2 pl-1 grow"}
        onMouseEnter={() => {
          if (user.uid === socketId) {
            setEdit(true)
          }
        }}
        onMouseLeave={() => {
          if (user.uid === socketId) {
            setEdit(false)
          }
        }}
      >
        {edit ? (
          <InputText
            className={"grow h-full"}
            value={name}
            onChange={updateName}
            placeholder={"Change your name"}
          />
        ) : (
          <>
            <div className={"flex flex-row gap-1 truncate"}>{user.name}</div>
            <div className={"flex flex-row gap-1 items-center"}>
              {user.player.paused ? (
                <IconPause sizeClassName={"w-3 h-3"} />
              ) : (
                <IconPlay sizeClassName={"w-3 h-3"} />
              )}
              {secondsToTime(user.player.progress)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default UserItem
