import React from "react";
import socketIOClient, {Socket} from "socket.io-client";
import {Col, Container, Row, Spinner} from "react-bootstrap";
import ReactPlayer from "react-player";
import {Helmet} from "react-helmet";
import User from "./User";
import Chat from "./Chat";
import Player from "./Player";
import Queue from "./Queue";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

interface RoomProps {
    roomId: string
}

interface RoomState {
    chatExpanded: boolean,
    deleteQueueOnPlay: boolean,
    duration: number,
    history: ChatData[],
    id: string,
    loop: boolean,
    owner: string,
    playbackRate: number,
    played: number,
    playing: boolean,
    queue: string[],
    queueIndex: number,
    url: string,
    users: UserData[]
}

export interface UserData extends RoomState {
    name: string,
    muted: boolean,
    icon: string,
    volume: number
}

export interface ChatData {
    user: UserData,
    time: number,
    message: string
}

class Room extends React.Component<RoomProps, RoomState> {
    socket: Socket | null;
    initialStatusReceived: boolean;

    constructor(props: RoomProps) {
        super(props);
        this.socket = null;
        this.initialStatusReceived = false;

        this.state = {
            chatExpanded: true,
            deleteQueueOnPlay: false,
            duration: 0,
            history: [] as ChatData[],
            id: this.props.roomId,
            loop: false,
            owner: "loading...",
            playbackRate: 1,
            played: 0,
            playing: false,
            queue: [
                "https://youtu.be/NcBjx_eyvxc",
                "https://youtu.be/uD4izuDMUQA",
                "https://youtu.be/UjtOGPJ0URM",
                "https://youtu.be/GfO-3Oir-qM?list=PLvahqwMqN4M0GRkZY8WkLZMb6Z-W7qbLA"
            ],
            queueIndex: 0,
            url: "https://youtu.be/NcBjx_eyvxc",
            users: [] as UserData[],
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
        if (this.socket) {
            this.socket.emit("update", {
                icon,
                name
            });
        }
    }

    updateState(data: any) {
        if (this.socket) {
            this.socket.emit("update", data);
        }
        this.setState(data);
    }

    changeToURL(url: string) {
        if (ReactPlayer.canPlay(url)) {
            this.updateState({
                queueIndex: -1
            });
            this.load(url);
        } else {
            console.log("Error, cannot play url:", url);
        }
    }

    load(url: string) {
        this.updateState({
            played: 0,
            playing: true,
            url
        });
    }

    playNext(url: string) {
        if (this.state.queueIndex >= 0) {
            this.updateState({
                queue: [...this.state.queue].splice(this.state.queueIndex, 0, url),
                queueIndex: this.state.queueIndex + 1
            });
        } else {
            this.updateState({
                queue: [url, ...this.state.queue]
            });
        }
    }

    addToQueue(url: string) {
        this.updateState({
            queue: [...this.state.queue, url]
        });
    }

    playFromQueue(index: number) {
        this.load(this.state.queue[index]);

        if (this.state.deleteQueueOnPlay) {
            this.updateState({
                queue: [...this.state.queue].filter((e, i) => i !== index)
            });
        } else {
            this.updateState({
                queueIndex: index
            });
        }
    }

    swapQueueItems(oldIndex: number, newIndex: number) {
        const queue = [...this.state.queue];
        const old = queue[oldIndex];
        queue[oldIndex] = queue[newIndex];
        queue[newIndex] = old;

        if ([oldIndex, newIndex].includes(this.state.queueIndex)) {
            this.updateState({
                queue,
                queueIndex: this.state.queueIndex === newIndex ? oldIndex : newIndex
            });
        } else {
            this.updateState({
                queue
            });
        }
    }

    deleteFromQueue(index: number) {
        if (this.state.queueIndex >= index) {
            this.updateState({
                queue: [...this.state.queue].filter((e, i) => i !== index),
                queueIndex: this.state.queueIndex - 1
            });
        } else {
            this.updateState({
                queue: [...this.state.queue].filter((e, i) => i !== index)
            });
        }
    }

    clearQueue() {
        if (this.state.deleteQueueOnPlay) {
            this.updateState({
                queue: [],
            });
        } else {
            this.updateState({
                queue: [this.state.queue[this.state.queueIndex]],
                queueIndex: 0
            });
        }
    }

    setQueueMode(deleteQueueOnPlay: boolean) {
        if (deleteQueueOnPlay) {
            this.updateState({
                deleteQueueOnPlay,
                queueIndex: -1
            });
        } else {
            this.updateState({
                deleteQueueOnPlay
            });
        }
    }

    render() {
        return (
            <Container fluid={true}>
                <Helmet>
                    <title>
                        Room {this.props.roomId} | Playing {this.state.url}
                    </title>
                    <link rel="canonical" href={"/room/" + this.props.roomId}/>
                </Helmet>
                <div className={"px-2"}>
                    <Row className={"p-0"}>
                        <Col className={"p-2"}>
                            {this.initialStatusReceived ?
                                <Player
                                    socket={this.socket}
                                    url={this.state.url}
                                    playing={this.state.playing}
                                    played={this.state.played}
                                    playbackRate={this.state.playbackRate}
                                    loop={this.state.loop}
                                    queueIndex={this.state.queueIndex}
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
                                  play={this.changeToURL.bind(this)}
                                  addQueue={this.addToQueue.bind(this)}
                                  playNext={this.playNext.bind(this)}
                                  history={this.state.history}/>
                        </Col>
                    </Row>
                </div>
                <Queue queueIndex={this.state.queueIndex}
                       queue={this.state.queue}
                       play={this.changeToURL.bind(this)}
                       playFromQueue={this.playFromQueue.bind(this)}
                       deleteFromQueue={this.deleteFromQueue.bind(this)}
                       swapQueueItems={this.swapQueueItems.bind(this)}
                       clearQueue={this.clearQueue.bind(this)}
                       addToQueue={this.addToQueue.bind(this)}/>
                <div className={"px-2"}>
                    <Row className={"user-list"}>
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
                </div>
            </Container>
        );
    }
}

export default Room;
