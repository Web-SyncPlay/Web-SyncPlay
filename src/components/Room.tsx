import React from "react";
import socketIOClient, {Socket} from "socket.io-client";
import {Col, Container, Row, Spinner} from "react-bootstrap";
import ReactPlayer from "react-player";
import {Helmet} from "react-helmet";
import User from "./User";
import Chat from "./chat/Chat";
import Player from "./player/Player";
import Queue from "./queue/Queue";
import {getUrl, PlayURL} from "./queue/QueueItem";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://192.168.178.57:8081";

interface RoomProps {
    roomId: string
}

interface RoomState {
    chatExpanded: boolean,
    duration: number,
    history: ChatData[],
    id: string,
    loop: boolean,
    owner: string,
    playbackRate: number,
    played: number,
    playing: boolean,
    queue: string[] | PlayURL[],
    queueIndex: number,
    url: string | PlayURL,
    users: UserData[]
}

export interface UserData extends RoomState {
    embed: boolean,
    name?: string,
    muted: boolean,
    icon?: string,
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
            duration: 0,
            history: [] as ChatData[],
            id: this.props.roomId,
            loop: false,
            owner: "loading...",
            playbackRate: 1,
            played: 0,
            playing: true,
            queue: [
                "https://youtu.be/NcBjx_eyvxc",
                "https://youtu.be/uD4izuDMUQA",
                "https://youtu.be/UjtOGPJ0URM",
            ],
            queueIndex: 0,
            url: "https://youtu.be/NcBjx_eyvxc",
            users: [] as UserData[],
        };
    }

    componentDidMount() {
        this.socket = socketIOClient(ENDPOINT, {
            query: {
                roomId: this.props.roomId,
                isEmbed: "false"
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

        this.socket.on("chat", (data) => {
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

    changeToURL(url: string | PlayURL) {
        if (ReactPlayer.canPlay(getUrl(url))) {
            this.updateState({
                queueIndex: -1
            });
            this.load(url);
        } else {
            this.sendChat("unable to play" + url);
            console.error("unable to play", url);
        }
    }

    load(url: string | PlayURL) {
        this.updateState({
            interaction: true,
            played: 0,
            playing: true,
            url
        });
    }

    playNext(url: string) {
        if (this.state.queueIndex >= 0) {
            this.updateState({
                interaction: true,
                queue: [...this.state.queue].splice(this.state.queueIndex, 0, url),
                queueIndex: this.state.queueIndex + 1
            });
        } else {
            this.updateState({
                interaction: true,
                queue: [url, ...this.state.queue]
            });
        }
    }

    addToQueue(url: string) {
        this.updateState({
            interaction: true,
            queue: [...this.state.queue, url]
        });
    }

    playFromQueue(index: number) {
        this.load(this.state.queue[index]);

        this.updateState({
            interaction: true,
            queueIndex: index
        });
    }

    swapQueueItems(oldIndex: number, newIndex: number) {
        const queue = [...this.state.queue];
        const old = queue[oldIndex];
        queue[oldIndex] = queue[newIndex];
        queue[newIndex] = old;

        if ([oldIndex, newIndex].includes(this.state.queueIndex)) {
            this.updateState({
                interaction: true,
                queue,
                queueIndex: this.state.queueIndex === newIndex ? oldIndex : newIndex
            });
        } else {
            this.updateState({
                interaction: true,
                queue
            });
        }
    }

    deleteFromQueue(index: number) {
        if (this.state.queueIndex >= index) {
            this.updateState({
                interaction: true,
                queue: [...this.state.queue].filter((e, i) => i !== index),
                queueIndex: this.state.queueIndex - 1
            });
        } else {
            this.updateState({
                interaction: true,
                queue: [...this.state.queue].filter((e, i) => i !== index)
            });
        }
    }

    clearQueue() {
        this.updateState({
            interaction: true,
            queue: [],
            queueIndex: -1
        });
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
                                    controlsHidden={false}
                                    showRootPlayer={false}
                                    id={this.state.id}
                                    isEmbed={false}
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
                            <Chat addQueue={this.addToQueue.bind(this)}
                                  history={this.state.history}
                                  owner={this.state.owner}
                                  play={this.changeToURL.bind(this)}
                                  playNext={this.playNext.bind(this)}
                                  send={this.sendChat.bind(this)}
                                  you={this.socket?.id || ""}/>
                        </Col>
                    </Row>
                </div>
                <Queue addToQueue={this.addToQueue.bind(this)}
                       clearQueue={this.clearQueue.bind(this)}
                       deleteFromQueue={this.deleteFromQueue.bind(this)}
                       play={this.changeToURL.bind(this)}
                       playFromQueue={this.playFromQueue.bind(this)}
                       queue={this.state.queue}
                       queueIndex={this.state.queueIndex}
                       roomId={this.state.id}
                       swapQueueItems={this.swapQueueItems.bind(this)}
                       url={this.state.url}/>
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
