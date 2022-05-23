import React, { FC, useEffect, useState } from "react"
import { Draggable } from "react-beautiful-dnd"
import classNames from "classnames"
import { MediaElement } from "../../lib/types"
import NewTabLink from "../action/NewTabLink"
import IconNewTab from "../icon/IconNewTab"
import IconDrag from "../icon/IconDrag"
import DeleteButton from "../action/DeleteButton"
import InputText from "../input/InputText"
import ControlButton from "../input/ControlButton"
import IconPlay from "../icon/IconPlay"
import IconDisk from "../icon/IconDisk"
import { getDomain } from "../../lib/utils"

interface Props {
  playing: boolean
  item: MediaElement
  index: number
  play: () => void
  deleteItem: (index: number) => void
  updateTitle: (title: string) => void
}

const PlaylistItem: FC<Props> = ({
  playing,
  item,
  index,
  play,
  deleteItem,
  updateTitle,
}) => {
  const [edit, setEdit] = useState(false)
  const [title, _setTitle] = useState(item.title || "")
  const setTitle = (newTitle: string) => {
    _setTitle(newTitle)
  }

  useEffect(() => {
    if (!edit) {
      setTitle(item.title || "")
    }
  }, [edit, item.title])

  const itemTitle = () => {
    if (item.title && item.title !== "") {
      return item.title
    }

    return "Item #" + (index + 1)
  }

  return (
    <Draggable
      key={item.src[0].src + "-" + index}
      draggableId={"playlistMenu-item-" + index}
      index={index}
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          style={provided.draggableProps.style}
          className={classNames(
            "p-1 rounded flex flex-col",
            snapshot.isDragging ? "bg-dark-700" : "bg-dark-900"
          )}
        >
          <div className={"flex flex-row gap-1 items-center"}>
            <div
              className={classNames(
                "p-1 transition-colors hover:text-primary-900",
                snapshot.isDragging && "text-primary-800"
              )}
              {...provided.dragHandleProps}
            >
              <IconDrag />
            </div>
            <div
              className={"flex grow"}
              onMouseEnter={() => setEdit(true)}
              onMouseLeave={() => setEdit(false)}
            >
              {edit ? (
                <InputText
                  onChange={updateTitle}
                  placeholder={"Set a title"}
                  value={title}
                />
              ) : (
                itemTitle()
              )}
            </div>
            <DeleteButton
              tooltip={"Delete " + itemTitle()}
              onClick={() => deleteItem(index)}
            />
          </div>
          <div className={"flex flex-row items-center"}>
            <ControlButton
              tooltip={playing ? "Currently playing" : "Play item now"}
              onClick={() => {
                if (!playing) {
                  play()
                }
              }}
              interaction={() => {}}
            >
              {playing ? (
                <IconDisk
                  className={"animate-spin animate-pulse text-purple-700"}
                />
              ) : (
                <IconPlay
                  className={"text-primary-900 hover:text-primary-900"}
                />
              )}
            </ControlButton>
            <NewTabLink
              href={item.src[0].src}
              className={"flex flex-row gap-1"}
            >
              <div className={"line-clamp-2"}>{getDomain(item.src[0].src)}</div>
              <IconNewTab className={"shrink-0"} />
            </NewTabLink>
          </div>
        </div>
      )}
    </Draggable>
  )
}

export default PlaylistItem
