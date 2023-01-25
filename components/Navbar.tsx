import Link from "next/link"
import Image from "next/image"
import { getSiteDomain, getSiteName } from "../lib/env"
import Button from "./action/Button"
import IconShare from "./icon/IconShare"
import React, { useState } from "react"
import Modal from "./modal/Modal"
import InputClipboardCopy from "./input/InputClipboardCopy"
import { Tooltip } from "react-tooltip"

const Navbar = ({ roomId }: { roomId?: string }) => {
  const [showShare, setShowShare] = useState(false)

  return (
    <div className={"py-1 px-2 flex flex-row gap-1 items-stretch bg-dark-900"}>
      <Link
        href={"/"}
        className={
          "flex p-1 shrink-0 flex-row gap-1 items-center rounded action"
        }
      >
        <Image
          src={"/logo_white.png"}
          alt={"Web-SyncPlay logo"}
          width={36}
          height={36}
        />
        <span className={"hide-below-sm"}>{getSiteName()}</span>
      </Link>
      {roomId && (
        <>
          <Modal
            title={"Invite your friends"}
            show={showShare}
            close={() => setShowShare(false)}
          >
            <div>Share this link to let more people join in on the fun</div>
            <InputClipboardCopy
              className={"bg-dark-1000"}
              value={getSiteDomain() + "/room/" + roomId}
            />
          </Modal>
          <Button
            tooltip={"Share the room link"}
            id={"navbar"}
            actionClasses={"hover:bg-primary-800 active:bg-primary-700"}
            className={"ml-auto p-2 bg-primary-900"}
            onClick={() => setShowShare(true)}
          >
            <div className={"flex items-center mx-1"}>
              <IconShare className={"mr-1"} />
              Share
            </div>
          </Button>
        </>
      )}

      <Tooltip
        anchorId={"navbar"}
        place={"bottom"}
        style={{
          backgroundColor: "var(--dark-700)",
        }}
      />
    </div>
  )
}

export default Navbar
