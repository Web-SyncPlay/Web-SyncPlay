import React from "react";
import socketIOClient, {Socket} from "socket.io-client";
import {Col, Row, Spinner} from "react-bootstrap";
import ReactPlayer from "react-player";
import "./Room.css";
import {Helmet} from "react-helmet";
import User from "./User";
import Chat from "./Chat";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

interface RoomProps {
    roomId: string
}

interface RoomState {
    id: string,
    url: string,
    queue: string[],
    owner: string,
    playing: boolean,
    volume: number,
    muted: boolean,
    played: number,
    loaded: number,
    duration: number,
    playbackRate: number,
    loop: boolean,
    ready: boolean,
    buffering: boolean,
    seeking: boolean,
    chatExpanded: boolean,
    users: UserData[],
    history: ChatData[]
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

class Room extends React.Component<RoomProps, RoomState> {
    player: React.RefObject<ReactPlayer>;
    initialStatusReceived: boolean;
    clickEvent: boolean;
    clickedTime: number;
    socket?: Socket;

    constructor(props: RoomProps) {
        super(props);
        this.initialStatusReceived = false;
        this.clickEvent = false;
        this.clickedTime = 0;
        this.player = React.createRef<ReactPlayer>();

        this.state = {
            id: this.props.roomId,
            owner: "loading...",
            url: "https://youtu.be/NcBjx_eyvxc",
            queue: [],
            playing: false,
            volume: 0.3,
            muted: true,
            played: 0,
            loaded: 0,
            duration: 0,
            playbackRate: 1,
            loop: false,
            ready: false,
            buffering: false,
            seeking: false,
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

            if (data.played) {
                if (Math.abs(this.state.played - data.played) * this.state.duration > 2) {
                    this.player.current?.seekTo(data.played, 'fraction');
                }
            }
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
        this.socket?.emit("chat", {
            message: message
        });
    }

    updateUser(name: string, icon: string) {
        this.updateState({
            icon: icon,
            name: name
        });
    }

    updateState(data: any) {
        if (this.socket) {
            data.userClicked = this.clickEvent;
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
            url: url,
            queue: queue,
            ready: false,
            played: 0,
            loaded: 0,
            playing: true
        });
    }

    playFromQueue(index: number) {
        const next = this.state.queue[index];
        this.load(next, [...this.state.queue].filter((e, i) => i !== index))
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

    handleClick(event: any) {
        console.log("touchy", event);
        this.clickedTime = new Date().getTime();
        this.clickEvent = true;
        console.log("User interaction!", this.clickedTime);
        setTimeout(() => {
            if (new Date().getTime() - this.clickedTime > 200) {
                this.clickEvent = false;
            }
        }, 300);
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
                            <ReactPlayer
                                style={{
                                    maxHeight: "calc(100vh - 169px)"
                                }}
                                ref={this.player}
                                className='react-player'
                                width='100%'
                                height={"calc((9 / 16) * 100vw)"}
                                url={this.state.url}
                                pip={true}
                                playing={this.state.playing}
                                controls={true}
                                loop={this.state.loop}
                                playbackRate={this.state.playbackRate}
                                volume={this.state.volume}
                                muted={this.state.muted}
                                onReady={() => this.updateState({ready: true})}
                                onStart={() => console.log('onStart')}
                                onPlay={() => this.updateState({playing: true})}
                                onPause={() => this.updateState({playing: false})}
                                onBuffer={() => this.updateState({buffering: true})}
                                onBufferEnd={() => this.updateState({buffering: false})}
                                onSeek={e => console.log('onSeek', e)}
                                onEnded={() => {
                                    if (this.state.loop) {
                                        this.updateState({
                                            playing: true,
                                            played: 0
                                        })
                                    } else {
                                        this.updateState({playing: false})
                                    }
                                }}
                                onError={e => console.log('onError', e)}
                                onProgress={progress => {
                                    // We only want to update time slider if we are not currently seeking
                                    if (!this.state.seeking) {
                                        this.updateState(progress)
                                    }
                                }}
                                onDuration={duration => this.updateState({duration: duration})}
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
                    {this.state.users.map(user => {
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
