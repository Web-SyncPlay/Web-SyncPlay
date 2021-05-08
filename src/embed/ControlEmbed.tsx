import React from "react";
import {PlayURL} from "../components/queue/QueueItem";
import socketIOClient, {Socket} from "socket.io-client";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

interface ControlEmbedProps {
    roomId: string,
    query: string
}

interface ControlEmbedState {
    id: string,
    loop: boolean,
    playbackRate: number,
    played: number,
    playing: boolean,
    queue: string[] | PlayURL[],
    queueIndex: number,
    url: string | PlayURL
}

class ControlEmbed extends React.Component<ControlEmbedProps, ControlEmbedState> {
    socket: Socket | null;
    initialStatusReceived: boolean;

    constructor(props: ControlEmbedProps) {
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
                isEmbed: "true",
                isController: "true"
            }
        });

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

    render() {
        return (
            <div>
                Currently playing: {this.state.url}
            </div>
        );
    }
}

export default ControlEmbed;
