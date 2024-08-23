import { type FC, useEffect, useState, useRef } from "react";
import {
  Draggable as _Draggable,
  type DraggableProps,
} from "react-beautiful-dnd";
import classNames from "classnames";
import { type MediaElement } from "../../lib/types";
import NewTabLink from "../action/NewTabLink";
import DeleteButton from "../action/DeleteButton";
import InputText from "../input/InputText";
import ControlButton from "../input/ControlButton";
import { getDomain } from "../../lib/utils";
import { Disc3, ExternalLink, GripVertical, Play } from "lucide-react";

// HACK: this fixes type incompatibility
const Draggable = _Draggable as unknown as FC<DraggableProps>;

const titleGen = (item: MediaElement, index: number) => {
  if (item.title && item.title !== "") {
    return item.title;
  }
  return "Item #" + (index + 1);
};

export default function PlaylistItem({
  playing,
  item,
  index,
  play,
  deleteItem,
  updateTitle,
}: {
  playing: boolean;
  item: MediaElement;
  index: number;
  play: () => void;
  deleteItem: (index: number) => void;
  updateTitle: (title: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(item.title ?? "");
  const prevEdit = useRef(false);

  useEffect(() => {
    if (prevEdit.current !== edit) {
      if (!edit) {
        if (item.title !== title) {
          updateTitle(title || "");
        }
      }

      prevEdit.current = edit;
    }

    if (item.title && item.title !== "" && item.title !== title) {
      setTitle(item.title || "");
    }
  }, [edit, item.title, title, updateTitle]);

  return (
    <Draggable
      key={item.src[0]?.url + "-" + index}
      draggableId={"playlistMenu-item-" + index}
      index={index}
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          style={provided.draggableProps.style}
          className={classNames(
            "flex flex-col rounded p-1",
            snapshot.isDragging ? "bg-dark-700" : "bg-dark-900",
          )}
        >
          <div className={"flex flex-row items-center gap-1"}>
            <div
              className={classNames(
                "hover:text-primary-900 p-1 transition-colors",
                snapshot.isDragging && "text-primary-800",
              )}
              {...provided.dragHandleProps}
            >
              <GripVertical />
            </div>
            <div
              className={"flex grow"}
              onMouseEnter={() => setEdit(true)}
              onMouseLeave={() => setEdit(false)}
            >
              {edit ? (
                <InputText
                  onChange={setTitle}
                  placeholder={"Set a title"}
                  value={title}
                />
              ) : (
                titleGen(item, index)
              )}
            </div>
            <DeleteButton
              tooltip={"Delete " + title}
              onClick={() => deleteItem(index)}
            />
          </div>
          <div className={"flex flex-row items-center"}>
            <ControlButton
              tooltip={playing ? "Currently playing" : "Play item now"}
              onClick={() => {
                if (!playing) {
                  play();
                }
              }}
              interaction={() => null}
            >
              {playing ? (
                <Disc3 className={"animate-spin text-purple-700"} />
              ) : (
                <Play className={"text-primary-900 hover:text-primary-900"} />
              )}
            </ControlButton>
            <NewTabLink
              href={item.src[0]?.url ?? ""}
              className={"flex flex-row gap-1"}
            >
              <div className={"line-clamp-2"}>
                {getDomain(item.src[0]?.url ?? "")}
              </div>
              <ExternalLink className={"shrink-0"} />
            </NewTabLink>
          </div>
        </div>
      )}
    </Draggable>
  );
}
