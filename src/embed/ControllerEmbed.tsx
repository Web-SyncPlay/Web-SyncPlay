import React from "react";
import {getUrl, PlayURL} from "../components/queue/QueueItemView";
import socketIOClient, {Socket} from "socket.io-client";
import InputURL from "../components/InputURL";
import QueueView from "../components/queue/QueueView";
import "./ControllerEmbed.css";
import InviteModal from "../components/modal/InviteModal";
import {Button} from "react-bootstrap";
import {
    GiAnticlockwiseRotation,
    GiClockwiseRotation,
    IoPause,
    IoPlay,
    IoPlaySkipBackSharp,
    IoPlaySkipForwardSharp,
    IoShareSocial,
    MdReplay
} from "react-icons/all";
import ControlButtonOverlay from "../components/player/ControlButtonOverlay";
import {canPlay} from "../utils";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

interface ControlEmbedProps {
    roomId: string
}

interface ControlEmbedState {
    duration: number,
    id: string,
    inviteModalOpen: boolean;
    loop: boolean,
    playbackRate: number,
    played: number,
    playing: boolean,
    queue: string[] | PlayURL[],
    queueIndex: number,
    url: string | PlayURL
}

class ControllerEmbed extends React.Component<ControlEmbedProps, ControlEmbedState> {
    socket: Socket | null;
    initialStatusReceived: boolean;

    constructor(props: ControlEmbedProps) {
        super(props);
        this.socket = null;
        this.initialStatusReceived = false;

        this.state = {
            duration: 0,
            id: this.props.roomId,
            inviteModalOpen: false,
            loop: false,
            playbackRate: 1,
            played: 0,
            playing: true,
            queue: [],
            queueIndex: -1,
            url: ""
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

    updateState(data: any) {
        if (this.socket) {
            this.socket.emit("update", data);
        }
        this.setState(data);
    }

    playEnded() {
        return !this.state.playing && ((1 - this.state.played) * this.state.duration < 1);
    }

    changeToURL(url: string | PlayURL) {
        if (canPlay(getUrl(url))) {
            this.updateState({
                interaction: true,
                played: 0,
                playing: true,
                queueIndex: -1,
                url
            });
        } else {
            console.error("unable to play", url);
        }
    }

    render() {
        return (
            <div className={"controller-embed p-2"}>
                <div className={"d-flex mb-2"}>
                    <div className={"controller-card p-2 rounded shadow"}>
                        <h5 className={"mb-0"}>Room {this.props.roomId}</h5>
                        <div>
                            Currently playing:
                            <a className={"ml-1"}
                               href={getUrl(this.state.url)}
                               target={"_blank"} rel={"noreferrer"}>
                                {getUrl(this.state.url)}
                            </a>
                        </div>
                    </div>
                    <Button className={"ml-2"}
                            onClick={() => this.setState({inviteModalOpen: true})}
                            variant={"success"}>
                        <IoShareSocial style={{
                            marginTop: "-0.25em"
                        }}/>
                        <span className={"ml-1"}>
                            Share
                        </span>
                    </Button>
                </div>
                <div className={"controller-card p-2 my-2 rounded shadow"}>
                    <InputURL
                        label={<h5 className={"mb-0"}>Play from URL</h5>}
                        submit={this.changeToURL.bind(this)}>
                        Play
                    </InputURL>
                </div>
                <div className={"controller-card controller-panel p-2 my-2 rounded shadow d-flex"}>
                    {0 < this.state.queueIndex ?
                        <ControlButtonOverlay
                            id={"playerControl-previous"}
                            onClick={(e, touch) => {
                                this.updateState({
                                    interaction: true,
                                    played: 0,
                                    playing: true,
                                    queueIndex: this.state.queueIndex - 1,
                                    url: this.state.queue[this.state.queueIndex - 1]
                                });
                            }}
                            tooltip={"Play previous"}>
                            <IoPlaySkipBackSharp/>
                        </ControlButtonOverlay> : <></>}
                    {this.state.queue.length > this.state.queueIndex + 1 && this.state.queueIndex > -1 ?
                        <ControlButtonOverlay
                            id={"playerControl-next"}
                            onClick={(e, touch) => {
                                this.updateState({
                                    interaction: true,
                                    played: 0,
                                    playing: true,
                                    queueIndex: this.state.queueIndex + 1,
                                    url: this.state.queue[this.state.queueIndex + 1]
                                });
                            }}
                            tooltip={"Play next"}>
                            <IoPlaySkipForwardSharp/>
                        </ControlButtonOverlay> : <></>}
                    {this.state.queue.length > 0 ?
                        <div className={"divider align-self-strech mx-1"}/> : <></>}
                    {this.state.played * this.state.duration > 0 ?
                        <ControlButtonOverlay
                            id={"playerControl-rewind"}
                            onClick={(e, touch) => {
                                const newTime = this.state.played * this.state.duration - 5;
                                this.updateState({
                                    interaction: true,
                                    played: (newTime > 0 ? newTime :
                                        0) / this.state.duration
                                });
                            }}
                            tooltip={"Rewind 5s"}>
                            <GiAnticlockwiseRotation/>
                        </ControlButtonOverlay> : <></>}
                    {!this.playEnded() ?
                        <ControlButtonOverlay
                            id={"playerControl-forward"}
                            onClick={(e, touch) => {
                                const newTime = this.state.played * this.state.duration + 5;
                                this.updateState({
                                    interaction: true,
                                    played: (newTime < this.state.duration ? newTime :
                                        this.state.duration) / this.state.duration
                                });
                            }}
                            tooltip={"Forward 5s"}>
                            <GiClockwiseRotation/>
                        </ControlButtonOverlay> : <></>}
                    <div className={"ml-auto"}>
                        <ControlButtonOverlay
                            id={"playerControl-play"}
                            onClick={(e, touch) => {
                                if (this.playEnded()) {
                                    this.updateState({
                                        interaction: true,
                                        played: 0,
                                        playing: true
                                    });
                                } else {
                                    this.updateState({
                                        interaction: true,
                                        playing: !this.state.playing
                                    });
                                }
                            }}
                            tooltip={this.state.playing ? "Pause" :
                                (this.playEnded() ? "Restart" : "Play")}>
                            {this.state.playing ? <IoPause/> : (this.playEnded() ? <MdReplay/> :
                                <IoPlay/>)}
                        </ControlButtonOverlay>
                    </div>
                </div>
                <QueueView isEmbed={true}
                           queue={this.state.queue}
                           queueIndex={this.state.queueIndex}
                           roomId={this.state.id}
                           updateState={this.updateState.bind(this)}
                           url={this.state.url}/>
                <InviteModal roomId={this.props.roomId}
                             show={this.state.inviteModalOpen}
                             closeModal={() => this.setState({inviteModalOpen: false})}/>
            </div>
        );
    }
}

export default ControllerEmbed;
