import React from "react";
import socketIOClient, {Socket} from "socket.io-client";
import Player from "../components/player/Player";
import {Spinner} from "react-bootstrap";
import {PlayURL} from "../components/queue/QueueItemView";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

export interface PlayerEmbedQueryParams {
    controlsHidden: string,
    url: string,
    queueUrl: string,
    queueIndex: string,
}

interface PlayerEmbedProps {
    roomId: string,
    query: string
}

interface PlayerEmbedState {
    controlsHidden: boolean,
    showRootPlayer: boolean,
    id: string,
    loop: boolean,
    playbackRate: number,
    played: number,
    playing: boolean,
    queue: string[] | PlayURL[],
    queueIndex: number,
    url: string | PlayURL
}

class PlayerEmbed extends React.Component<PlayerEmbedProps, PlayerEmbedState> {
    socket: Socket | null;
    initialStatusReceived: boolean;

    constructor(props: PlayerEmbedProps) {
        super(props);
        this.socket = null;
        this.initialStatusReceived = false;

        let query = new URLSearchParams(this.props.query);

        let url;
        if (query.has("queue") && query.has("queueIndex")) {
            url = query.getAll("queue")[parseInt(query.get("queueIndex") as string)];
        } else {
            url = query.has("url") ? query.get("url") as string : "";
        }

        this.state = {
            controlsHidden: query.has("controlsHidden") ? query.get("controlsHidden") === "true" : false,
            showRootPlayer: query.has("showRootPlayer") ? query.get("showRootPlayer") === "true" : false,
            id: this.props.roomId,
            loop: false,
            playbackRate: 1,
            played: 0,
            playing: true,
            queue: query.has("queue") ? query.getAll("queue") : [],
            queueIndex: query.has("queueIndex") ? parseInt(query.get("queueIndex") as string) : -1,
            url: url
        };
    }

    componentDidMount() {
        this.socket = socketIOClient(ENDPOINT, {
            query: {
                roomId: this.props.roomId,
                isEmbed: "true"
            }
        });

        this.socket.emit("initialState", {
            queue: this.state.queue,
            queueIndex: this.state.queueIndex,
            url: this.state.url
        })

        this.socket.on("status", (data) => {
            this.initialStatusReceived = true;
            this.setState(data);
        });
    }

    componentWillUnmount() {
        if (this.socket!.connected) {
            this.socket!.disconnect();
        }
    }

    updateState(data: any) {
        if (this.socket) {
            this.socket.emit("update", data);
        }
        this.setState(data);
    }

    load(url: string | PlayURL) {
        this.updateState({
            played: 0,
            playing: true,
            url
        });
    }

    playFromQueue(index: number) {
        this.load(this.state.queue[index]);

        this.updateState({
            queueIndex: index
        });
    }

    render() {
        if (this.initialStatusReceived) {
            return (
                <Player
                    controlsHidden={this.state.controlsHidden}
                    showRootPlayer={this.state.showRootPlayer}
                    id={this.state.id}
                    isEmbed={true}
                    socket={this.socket}
                    url={this.state.url}
                    playing={this.state.playing}
                    played={this.state.played}
                    playbackRate={this.state.playbackRate}
                    loop={this.state.loop}
                    queueIndex={this.state.queueIndex}
                    queue={this.state.queue}
                    playFromQueue={this.playFromQueue.bind(this)}
                />
            );
        }
        return (
            <div className={"w-100 h-100 d-flex align-items-center justify-content-center"}>
                <Spinner animation={"border"} role={"status"}>
                    <span className={"sr-only"}>
                        Loading ...
                    </span>
                </Spinner>
            </div>
        );
    }
}

export default PlayerEmbed;
