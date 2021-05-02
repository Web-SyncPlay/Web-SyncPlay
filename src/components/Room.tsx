import React from "react";
import socketIOClient, {Socket} from "socket.io-client";
import {Col, Row, Spinner} from "react-bootstrap";
import ReactPlayer from "react-player";
import {Helmet} from "react-helmet";
import User from "./User";
import Chat from "./Chat";
import Player from "./Player";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

interface RoomProps {
    roomId: string
}

export interface UserData extends RoomState {
    name: string,
    icon: string
}

export interface ChatData {
    user: UserData,
    time: number,
    message: string
}

interface RoomState {
    id: string,
    url: string,
    queue: string[],
    owner: string,
    playing: boolean,
    played: number,
    duration: number,
    playbackRate: number,
    loop: boolean,
    chatExpanded: boolean,
    users: UserData[],
    history: ChatData[]
}

class Room extends React.Component<RoomProps, RoomState> {
    socket: Socket | null;
    initialStatusReceived: boolean;

    constructor(props: RoomProps) {
        super(props);
        this.socket = null;
        this.initialStatusReceived = false;

        this.state = {
            id: this.props.roomId,
            owner: "loading...",
            url: "https://youtu.be/NcBjx_eyvxc",
            queue: [],
            playing: false,
            played: 0,
            duration: 0,
            playbackRate: 1,
            loop: false,
            chatExpanded: true,
            users: [] as UserData[],
            history: [] as ChatData[]
        };
    }

    componentDidMount() {
        this.socket = socketIOClient(ENDPOINT, {
            query: {
                roomId: this.props.roomId
            }
        });

        this.socket.on("status", (data) => {
            this.initialStatusReceived = true;
            this.setState(data);
        });

        this.socket.on("chat", (data) => {
            console.log("chatted", data);
            this.setState({history: [...this.state.history, data]});
        });
    }


    componentWillUnmount() {
        if (this.socket!.connected) {
            this.socket!.disconnect();
        }
    }

    sendChat(message: string) {
        this.socket?.emit("chat", {message});
    }

    updateUser(name: string, icon: string) {
        this.updateState({
            icon,
            name
        });
    }

    updateState(data: any) {
        if (this.socket) {
            this.socket.emit("update", data);
        }
        this.setState(data);
    }

    changeToURL(url: string) {
        if (ReactPlayer.canPlay(url)) {
            this.load(url);
        } else {
            console.log("Error, cannot play url:", url);
        }
    }

    load(url: string, queue: string[] = this.state.queue) {
        this.updateState({
            url,
            queue,
            played: 0,
            playing: true
        });
    }

    playFromQueue(index: number) {
        const next = this.state.queue[index];
        this.load(next, [...this.state.queue].filter((e, i) => i !== index));
    }

    addToQueue(url: string) {
        this.updateState({
            queue: [...this.state.queue, url]
        });
    }

    removeFromQueue(index: number) {
        this.updateState({
            queue: [...this.state.queue].filter((e, i) => i !== index)
        });
    }

    render() {
        return (
            <>
                <Helmet>
                    <title>
                        Room {this.props.roomId} | Playing {this.state.url}
                    </title>
                    <link rel="canonical" href={"/room/" + this.props.roomId}/>
                </Helmet>
                <Row className={"mx-3 p-0"}>
                    <Col className={"p-2"}>
                        {this.initialStatusReceived ?
                            <Player
                                socket={this.socket}
                                url={this.state.url}
                                playing={this.state.playing}
                                played={this.state.played}
                                playbackRate={this.state.playbackRate}
                                loop={this.state.loop}
                                queue={this.state.queue}
                                playFromQueue={this.playFromQueue.bind(this)}
                            /> :
                            <div className={"w-100 d-flex align-items-center justify-content-center"}
                                 style={{height: 300}}>
                                <Spinner animation={"border"} role={"status"}>
                                    <span className={"sr-only"}>Loading...</span>
                                </Spinner>
                            </div>}
                    </Col>
                    <Col xs={"12"} md={"auto"} className={"p-2"}>
                        <Chat you={this.socket?.id || ""}
                              owner={this.state.owner}
                              send={this.sendChat.bind(this)}
                              history={this.state.history}/>
                    </Col>
                </Row>
                <Row className={"user-list mx-3 mb-3 p-0"}>
                    {this.state.users.map((user) => {
                            return (
                                <User key={user.id}
                                      user={user}
                                      duration={this.state.duration}
                                      owner={this.state.owner}
                                      you={this.socket?.id || ""}
                                      update={this.updateUser.bind(this)}/>
                            );
                        }
                    )}
                </Row>
            </>
        );
    }
}

export default Room;
