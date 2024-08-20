"use client";

import Button from "../action/Button";
import { useState } from "react";
import Modal from "../modal/Modal";
import InputClipboardCopy from "../input/InputClipboardCopy";
import { Tooltip } from "react-tooltip";
import { env } from "~/env";
import { NavbarLogo } from "./NavbarLogo";
import { Share2 } from "lucide-react";

export function Navbar({ roomId }: { roomId: string }) {
  const [showShare, setShowShare] = useState(false);

  return (
    <nav className={"bg-dark-900 flex flex-row items-stretch gap-1 px-2 py-1"}>
      <NavbarLogo />
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
              value={env.PUBLIC_DOMAIN + "/room/" + roomId}
            />
          </Modal>
          <Button
            tooltip={"Share the room link"}
            id={"navbar"}
            actionClasses={"hover:bg-primary-800 active:bg-primary-700"}
            className={"bg-primary-900 ml-auto p-2"}
            onClick={() => setShowShare(true)}
          >
            <div className={"mx-1 flex items-center"}>
              <Share2 className={"mr-1"} />
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
    </nav>
  );
}
