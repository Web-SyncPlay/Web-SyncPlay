import { type FC, useEffect, useRef, useState } from "react";
import type { MediaElement, Playlist, RoomState } from "~/lib/types";
import {
  DragDropContext as _DragDropContext,
  Droppable as _Droppable,
  type DragDropContextProps,
  type DroppableProps,
} from "react-beautiful-dnd";
import classNames from "classnames";
import { type Socket } from "socket.io-client";
import {
  type ClientToServerEvents,
  playItemFromPlaylist,
  type ServerToClientEvents,
} from "~/lib/socket";
import ControlButton from "../input/ControlButton";
import PlaylistItem from "./PlaylistItem";
import InputUrl from "../input/InputUrl";
import { ChevronDown, ChevronUp } from "lucide-react";

// HACK: this fixes type incompatibility
const DragDropContext = _DragDropContext as unknown as FC<DragDropContextProps>;
const Droppable = _Droppable as unknown as FC<DroppableProps>;

export default function PlaylistMenu({
  socket,
}: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [url, setUrl] = useState("");

  const [playlist, _setPlaylist] = useState<Playlist>({
    items: [],
    currentIndex: -1,
  });
  const playlistRef = useRef(playlist);
  const setPlaylist = (newPlaylist: Playlist) => {
    _setPlaylist(newPlaylist);
    playlistRef.current = newPlaylist;
  };

  useEffect(() => {
    socket.on("update", (room: RoomState) => {
      if (
        JSON.stringify(room.targetState.playlist) !==
        JSON.stringify(playlistRef.current)
      ) {
        setPlaylist(room.targetState.playlist);
      }
    });
  }, [socket]);

  const addItem = (newUrl: string) => {
    if (newUrl === "") {
      return;
    }
    setUrl("");

    const newMedia: MediaElement = {
      src: [
        {
          src: newUrl,
          resolution: "",
        },
      ],
      sub: [],
    };
    const newPlaylist = JSON.parse(JSON.stringify(playlist)) as Playlist;
    newPlaylist.items.push(newMedia);
    socket.emit("updatePlaylist", newPlaylist);
  };

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
                playlist.items[result.source.index],
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
              socket.emit("updatePlaylist", newPlaylist);
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
                        key={item.src[0]?.src + "-" + index}
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
                          socket.emit("updatePlaylist", newPlaylist);
                        }}
                        updateTitle={(newTitle) => {
                          const newPlaylist = JSON.parse(
                            JSON.stringify(playlist),
                          ) as Playlist;
                          newPlaylist.items[index].title = newTitle;
                          socket.emit("updatePlaylist", newPlaylist);
                        }}
                        play={() => {
                          playItemFromPlaylist(socket, playlist, index);
                        }}
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
