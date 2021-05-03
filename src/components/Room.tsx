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
    owner: string,
    playing: boolean,
    played: number,
    duration: number,
    playbackRate: number,
    loop: boolean,
    chatExpanded: boolean,
    queueIndex: number,
    deleteQueueOnPlay: boolean,
    queue: string[],
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
            playing: false,
            played: 0,
            duration: 0,
            playbackRate: 1,
            loop: false,
            chatExpanded: true,
            queueIndex: 0,
            deleteQueueOnPlay: false,
            queue: [
                "https://youtu.be/NcBjx_eyvxc",
                "https://youtu.be/uD4izuDMUQA",
                "https://youtu.be/UjtOGPJ0URM",
                "https://youtu.be/GfO-3Oir-qM?list=PLvahqwMqN4M0GRkZY8WkLZMb6Z-W7qbLA"
            ],
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
            this.load(url);
        } else {
            console.log("Error, cannot play url:", url);
        }
    }

    load(url: string) {
        this.updateState({
            url,
            played: 0,
            playing: true
        });
    }

    playNext(url: string) {
        if (this.state.queueIndex >= 0) {
            this.updateState({
                queueIndex: this.state.queueIndex + 1,
                queue: [...this.state.queue].splice(this.state.queueIndex, 0, url)
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
                queueIndex: this.state.queueIndex === newIndex ? oldIndex : newIndex,
                queue
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
                queueIndex: this.state.queueIndex - 1,
                queue: [...this.state.queue].filter((e, i) => i !== index)
            });
        } else {
            this.updateState({
                queue: [...this.state.queue].filter((e, i) => i !== index)
            });
        }
    }

    setQueueMode(deleteQueueOnPlay: boolean) {
        if (deleteQueueOnPlay) {
            this.updateState({
                queueIndex: -1,
                deleteQueueOnPlay
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
