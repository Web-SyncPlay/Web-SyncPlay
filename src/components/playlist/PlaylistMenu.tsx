import { type FC, useCallback, useState } from "react";
import type { MediaElement, Playlist } from "~/lib/types";
import {
  DragDropContext as _DragDropContext,
  Droppable as _Droppable,
  type DragDropContextProps,
  type DroppableProps,
} from "react-beautiful-dnd";
import classNames from "classnames";
import ControlButton from "../input/ControlButton";
import PlaylistItem from "./PlaylistItem";
import InputUrl from "../input/InputUrl";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useController } from "~/lib/hooks/useController";

// HACK: this fixes type incompatibility
const DragDropContext = _DragDropContext as unknown as FC<DragDropContextProps>;
const Droppable = _Droppable as unknown as FC<DroppableProps>;

export default function PlaylistMenu({ roomId }: { roomId: string }) {
  const { playlist, remote } = useController(roomId);
  const [expanded, setExpanded] = useState(true);
  const [url, setUrl] = useState("");

  const addItem = useCallback(
    (newUrl: string) => {
      if (newUrl === "") {
        return;
      }
      setUrl("");

      const newMedia: MediaElement = {
        src: [
          {
            url: newUrl,
            resolution: "",
          },
        ],
        sub: [],
      };
      const newPlaylist = JSON.parse(JSON.stringify(playlist)) as Playlist;
      newPlaylist.items.push(newMedia);
      remote.updatePlaylist(newPlaylist);
    },
    [playlist, remote],
  );

  return (
    <div className={classNames("flex flex-col", expanded && "sm:w-[300px]")}>
      <ControlButton
        tooltip={expanded ? "Hide playlist" : "Show playlist"}
        onClick={() => setExpanded(!expanded)}
        interaction={() => null}
        className={"flex flex-row gap-1"}
      >
        {expanded ? (
          <ChevronUp className={"sm:rotate-90"} />
        ) : (
          <ChevronDown className={"sm:rotate-90"} />
        )}
        <div className={classNames(!expanded && "sm:hidden")}>
          {expanded ? "Hide" : "Show"} Playlist
        </div>
      </ControlButton>
      {expanded && (
        <>
          <InputUrl
            url={url}
            placeholder={"Add url..."}
            tooltip={"Add url to the playlist"}
            onChange={setUrl}
            className={"my-1"}
            onSubmit={() => addItem(url)}
          >
            Add
          </InputUrl>
          <DragDropContext
            onDragEnd={(result) => {
              if (!result.destination) {
                return;
              }

              const newPlaylist = JSON.parse(
                JSON.stringify(playlist),
              ) as Playlist;
              newPlaylist.items.splice(result.source.index, 1);
              newPlaylist.items.splice(
                result.destination.index,
                0,
                playlist.items[result.source.index]!,
              );

              if (
                playlist.currentIndex > result.source.index &&
                playlist.currentIndex < result.destination.index
              ) {
                newPlaylist.currentIndex--;
              } else if (
                playlist.currentIndex < result.source.index &&
                playlist.currentIndex > result.destination.index
              ) {
                newPlaylist.currentIndex++;
              } else if (playlist.currentIndex === result.source.index) {
                newPlaylist.currentIndex = result.destination.index;
              }

              console.log("Playlist updated to:", newPlaylist);
              remote.updatePlaylist(newPlaylist);
            }}
          >
            <Droppable droppableId={"playlistMenu"}>
              {(provided, snapshot) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className={classNames(
                    "flex flex-col gap-1 rounded",
                    snapshot.isDraggingOver && "bg-dark-800",
                  )}
                >
                  <>
                    {playlist.items.map((item, index) => (
                      <PlaylistItem
                        key={item.src[0]?.url + "-" + index}
                        playing={playlist.currentIndex === index}
                        item={item}
                        index={index}
                        deleteItem={(index) => {
                          if (index < 0 || index >= playlist.items.length) {
                            return;
                          }

                          const newPlaylist = JSON.parse(
                            JSON.stringify(playlist),
                          ) as Playlist;
                          newPlaylist.items.splice(index, 1);
                          if (newPlaylist.currentIndex === index) {
                            newPlaylist.currentIndex = -1;
                          } else if (newPlaylist.currentIndex > index) {
                            newPlaylist.currentIndex--;
                          }
                          remote.updatePlaylist(newPlaylist);
                        }}
                        updateTitle={(newTitle) => {
                          const newPlaylist = JSON.parse(
                            JSON.stringify(playlist),
                          ) as Playlist;
                          newPlaylist.items[index]!.title = newTitle;
                          remote.updatePlaylist(newPlaylist);
                        }}
                        play={() => remote.playItemFromPlaylist(index)}
                      />
                    ))}
                    {provided.placeholder}
                  </>
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </>
      )}
    </div>
  );
}
