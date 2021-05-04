import React from "react";
import ReactPlayer from "react-player";
import {Socket} from "socket.io-client";
import {
    BiExitFullscreen,
    BiFullscreen,
    FaVolumeDown,
    FaVolumeMute,
    FaVolumeUp,
    IoPause,
    IoPlay,
    IoPlaySkipBackSharp,
    IoPlaySkipForwardSharp,
    IoShareOutline,
    MdReplay
} from "react-icons/all";
import {Form, OverlayTrigger, Tooltip} from "react-bootstrap";
import screenfull from "screenfull";
import "./Player.css";
import User from "./User";

const LEFT_MOUSE_CLICK = 0;

interface PlayerProps {
    controlsHidden: boolean,
    showRootPlayer: boolean,
    isEmbed: boolean,
    socket: Socket | null,
    url: string,
    playing: boolean,
    played: number,
    playbackRate: number,
    loop: boolean,
    queueIndex: number,
    queue: string[],
    playFromQueue: (index: number) => void
}

interface PlayerState {
    volume: number,
    muted: boolean,
    played: number,
    loaded: number,
    duration: number,
    ready: boolean,
    buffering: boolean,
    seeking: boolean,
    fullscreen: boolean,
    showTimePlayed: boolean,
    controlsHidden: boolean,
}

class Player extends React.Component<PlayerProps, PlayerState> {
    player: React.RefObject<ReactPlayer>;
    interaction: boolean;
    interactionTime: number;
    lastMouseMove: number;
    private fullscreenNode: HTMLDivElement | undefined;

    constructor(props: PlayerProps) {
        super(props);
        this.player = React.createRef();
        this.interaction = false;
        this.interactionTime = 0;
        this.lastMouseMove = 0;

        this.state = {
            buffering: false,
            controlsHidden: false,
            duration: 0,
            fullscreen: false,
            loaded: 0,
            muted: true,
            played: 0,
            ready: false,
            seeking: false,
            showTimePlayed: true,
            volume: 0.3
        };

        this.props.socket?.emit("update", {
            muted: true,
            volume: 0.3
        });
    }

    componentDidUpdate(prevProps: Readonly<PlayerProps>, prevState: Readonly<PlayerState>) {
        if (Math.abs(prevState.played - this.props.played) * prevState.duration > 2) {
            console.log("Desynced, seeking to ", this.props.played * prevState.duration);
            this.player.current?.seekTo(this.props.played, "fraction");
            this.setState({
                played: this.props.played
            });
        }
    }

    interact() {
        this.interaction = true;
        this.interactionTime = new Date().getTime();
        console.log("User interaction!", this.interactionTime);
        setTimeout(() => {
            if (new Date().getTime() - this.interactionTime > 250) {
                this.interaction = false;
            }
        }, 300);
    }

    updateState(data: any) {
        if (this.props.socket) {
            data.interaction = this.interaction;
            this.props.socket.emit("update", data);
        }
        this.setState(data);
    }

    playEnded() {
        return !this.props.playing && ((1 - this.state.played) * this.state.duration < 1);
    }

    mouseMoved() {
        this.lastMouseMove = new Date().getTime();
        if (this.state.controlsHidden) {
            this.setState({
                controlsHidden: false
            });
        }
        setTimeout(() => {
            if (new Date().getTime() - this.lastMouseMove > 1150) {
                this.setState({
                    controlsHidden: true
                });
            }
        }, 1200);
    }

    render() {
        return (
            <div className={"player"}
                 ref={(node) => this.fullscreenNode = node || undefined}>
                {this.props.showRootPlayer ? <></> :
                    <div className={"player-overlay p-2" + (this.state.controlsHidden ? " hide" : "")}
                         onTouchEnd={(e) => {
                             e.preventDefault();
                             this.mouseMoved();
                         }}
                         onMouseMove={() => {
                             this.mouseMoved();
                         }}
                         onMouseUp={() => {
                             this.mouseMoved();
                         }}>
                        {this.props.controlsHidden ? <></> :
                            <>
                                <div className={"player-center flex-grow-1"}
                                     onTouchEnd={(e) => {
                                         e.preventDefault();
                                         if (this.interaction) {
                                             this.interaction = false;
                                             if (screenfull.isEnabled) {
                                                 screenfull.toggle(this.fullscreenNode);
                                                 this.setState({fullscreen: !this.state.fullscreen});
                                             }
                                         } else if (!this.state.controlsHidden) {
                                             this.interact();
                                             setTimeout(() => {
                                                 if (this.interaction) {
                                                     this.updateState({playing: !this.props.playing});
                                                 }
                                             }, 250);
                                         }
                                     }}
                                     onMouseUp={(e) => {
                                         if (e.button !== LEFT_MOUSE_CLICK) {
                                             return;
                                         }

                                         if (this.interaction) {
                                             this.interaction = false;
                                             if (screenfull.isEnabled) {
                                                 screenfull.toggle(this.fullscreenNode);
                                                 this.setState({fullscreen: !this.state.fullscreen});
                                             }
                                         } else {
                                             this.interact();
                                             setTimeout(() => {
                                                 if (this.interaction) {
                                                     this.updateState({playing: !this.props.playing});
                                                 }
                                             }, 250);
                                         }
                                     }}/>
                                <div className={"player-controls px-2"}>
                                    <div className={"player-progress"}>
                                        <Form.Control
                                            type={"range"}
                                            min={0}
                                            max={1}
                                            step={0.001}
                                            onChange={(e) => {
                                                this.interact();
                                                const t = parseFloat(e.target.value);
                                                this.player.current?.seekTo(t);
                                                e.target.style.setProperty("--value", (t * 100) + "%");
                                                this.updateState({
                                                    played: t
                                                });
                                            }}
                                            style={{"--value": (this.state.played * 100) + "%"} as React.CSSProperties}
                                            aria-label={"Progress of playback"}
                                            value={this.state.played}/>
                                    </div>
                                    <div className={"px-1 pb-1 d-flex"}>
                                        {0 < this.props.queueIndex ?
                                            <OverlayTrigger
                                                placement={"top"}
                                                overlay={
                                                    <Tooltip id={"playerControl-previous"}>
                                                        Play previous
                                                    </Tooltip>
                                                }>
                                                <div className={"d-none d-sm-flex control-button mx-1"}
                                                     onTouchEnd={(e) => {
                                                         e.preventDefault();
                                                         if (!this.state.controlsHidden) {
                                                             this.props.playFromQueue(this.props.queueIndex - 1);
                                                         }
                                                     }}
                                                     onMouseUp={(e) => {
                                                         if (e.button !== LEFT_MOUSE_CLICK) {
                                                             return;
                                                         }
                                                         this.props.playFromQueue(this.props.queueIndex - 1);
                                                     }}>
                                                    <IoPlaySkipBackSharp/>
                                                </div>
                                            </OverlayTrigger> : <></>}
                                        <OverlayTrigger
                                            placement={"top"}
                                            overlay={
                                                <Tooltip id={"playerControl-play"}>
                                                    {this.props.playing ? "Pause" :
                                                        (this.playEnded() ? "Restart" : "Play")}
                                                </Tooltip>
                                            }>
                                            <div className={"control-button mx-1"}
                                                 onTouchEnd={(e) => {
                                                     e.preventDefault();
                                                     if (!this.state.controlsHidden) {
                                                         if (this.playEnded()) {
                                                             this.updateState({
                                                                 played: 0,
                                                                 playing: true
                                                             });
                                                         } else {
                                                             this.updateState({
                                                                 playing: !this.props.playing
                                                             });
                                                         }
                                                     }
                                                 }}
                                                 onMouseUp={(e) => {
                                                     if (e.button !== LEFT_MOUSE_CLICK) {
                                                         return;
                                                     }
                                                     if (this.playEnded()) {
                                                         this.updateState({
                                                             played: 0,
                                                             playing: true
                                                         });
                                                     } else {
                                                         this.updateState({
                                                             playing: !this.props.playing
                                                         });
                                                     }
                                                 }}>
                                                {this.props.playing ? <IoPause/> : (this.playEnded() ? <MdReplay/> :
                                                    <IoPlay/>)}
                                            </div>
                                        </OverlayTrigger>
                                        {this.props.queue.length > this.props.queueIndex + 1 && this.props.queueIndex > -1 ?
                                            <OverlayTrigger
                                                placement={"top"}
                                                overlay={
                                                    <Tooltip id={"playerControl-next"}>
                                                        Play next
                                                    </Tooltip>
                                                }>
                                                <div className={"control-button mx-1"}
                                                     onTouchEnd={(e) => {
                                                         e.preventDefault();
                                                         if (!this.state.controlsHidden) {
                                                             this.props.playFromQueue(this.props.queueIndex + 1);
                                                         }
                                                     }}
                                                     onMouseUp={(e) => {
                                                         if (e.button !== LEFT_MOUSE_CLICK) {
                                                             return;
                                                         }
                                                         this.props.playFromQueue(this.props.queueIndex + 1);
                                                     }}>
                                                    <IoPlaySkipForwardSharp/>
                                                </div>
                                            </OverlayTrigger> : <></>}
                                        <div className={"volume-control d-flex"}>
                                            <OverlayTrigger
                                                placement={"top"}
                                                overlay={
                                                    <Tooltip id={"playerControl-volume"}>
                                                        {this.state.muted || this.state.volume === 0 ? "Unmute" : "Mute"}
                                                    </Tooltip>
                                                }>
                                                <div className={"control-button mx-1"}
                                                     onTouchEnd={(e) => {
                                                         e.preventDefault();
                                                         if (!this.state.controlsHidden) {
                                                             if (this.state.volume === 0) {
                                                                 this.updateState({
                                                                     muted: false,
                                                                     volume: 0.3
                                                                 });
                                                             } else {
                                                                 this.updateState({
                                                                     muted: !this.state.muted
                                                                 });
                                                             }
                                                         }
                                                     }}
                                                     onMouseUp={(e) => {
                                                         if (e.button !== LEFT_MOUSE_CLICK) {
                                                             return;
                                                         }
                                                         if (this.state.volume === 0) {
                                                             this.updateState({
                                                                 muted: false,
                                                                 volume: 0.3
                                                             });
                                                         } else {
                                                             this.updateState({
                                                                 muted: !this.state.muted
                                                             });
                                                         }
                                                     }}>
                                                    {this.state.muted || this.state.volume === 0 ? <FaVolumeMute/> :
                                                        (this.state.volume > 0.6 ? <FaVolumeUp/> : <FaVolumeDown/>)}
                                                </div>
                                            </OverlayTrigger>
                                            <div className={"d-none d-sm-block volume-slider"}>
                                                <Form.Control
                                                    type={"range"}
                                                    min={0}
                                                    max={1}
                                                    step={0.001}
                                                    onChange={(e) => {
                                                        const t = parseFloat(e.target.value);
                                                        if (this.state.muted && t > 0) {
                                                            this.setState({
                                                                muted: false,
                                                                volume: t
                                                            });
                                                        } else {
                                                            this.setState({
                                                                volume: t
                                                            });
                                                        }
                                                        e.target.style.setProperty("--value", (t * 100) + "%");
                                                    }}
                                                    style={{"--value": ((this.state.muted ? 0 : this.state.volume) * 100) + "%"} as React.CSSProperties}
                                                    aria-label={"Progress of playback"}
                                                    value={this.state.muted ? 0 : this.state.volume}/>
                                            </div>
                                        </div>

                                        <div className={"ml-auto d-flex"}>
                                            <div className={"control-button mx-1"}
                                                 style={{
                                                     alignSelf: "center"
                                                 }}
                                                 onTouchEnd={(e) => {
                                                     e.preventDefault();
                                                     if (!this.state.controlsHidden) {
                                                         this.setState({showTimePlayed: !this.state.showTimePlayed});
                                                     }
                                                 }}
                                                 onMouseUp={(e) => {
                                                     if (e.button !== LEFT_MOUSE_CLICK) {
                                                         return;
                                                     }
                                                     this.setState({showTimePlayed: !this.state.showTimePlayed});
                                                 }}>
                                                {(this.state.showTimePlayed ? User.secondsToTime(this.state.played * this.state.duration) :
                                                    "-" + User.secondsToTime((1 - this.state.played) * this.state.duration)) + " / " +
                                                User.secondsToTime(this.state.duration)}
                                            </div>
                                            <OverlayTrigger
                                                placement={"top"}
                                                overlay={
                                                    <Tooltip id={"playerControl-volume"}>
                                                        Open source in new tab
                                                    </Tooltip>
                                                }>
                                                <div className={"d-none d-sm-flex control-button mx-1"}
                                                     onTouchEnd={(e) => {
                                                         e.preventDefault();
                                                         if (!this.state.controlsHidden) {
                                                             window.open(this.props.url, "_blank");
                                                         }
                                                     }}
                                                     onMouseUp={(e) => {
                                                         if (e.button !== LEFT_MOUSE_CLICK) {
                                                             return;
                                                         }
                                                         window.open(this.props.url, "_blank");
                                                     }}>
                                                    <IoShareOutline/>
                                                </div>
                                            </OverlayTrigger>
                                            {screenfull.isEnabled ?
                                                <OverlayTrigger
                                                    placement={"top"}
                                                    overlay={
                                                        <Tooltip id={"playerControl-volume"}>
                                                            {this.state.fullscreen ? "Exit" : "Enter"} fullscreen
                                                        </Tooltip>
                                                    }>
                                                    <div className={"control-button mx-1"}
                                                         onTouchEnd={(e) => {
                                                             e.preventDefault();
                                                             if (screenfull.isEnabled) {
                                                                 screenfull.toggle(this.fullscreenNode);
                                                                 this.setState({fullscreen: !this.state.fullscreen});
                                                             }
                                                         }}
                                                         onMouseUp={(e) => {
                                                             if (e.button !== LEFT_MOUSE_CLICK) {
                                                                 return;
                                                             }
                                                             if (screenfull.isEnabled) {
                                                                 screenfull.toggle(this.fullscreenNode);
                                                                 this.setState({fullscreen: !this.state.fullscreen});
                                                             }
                                                         }}>
                                                        {this.state.fullscreen ? <BiExitFullscreen/> : <BiFullscreen/>}
                                                    </div>
                                                </OverlayTrigger> : <></>
                                            }
                                        </div>
                                    </div>
                                </div>
                            </>
                        }
                    </div>
                }
                <ReactPlayer
                    style={{
                        backgroundColor: "#000000",
                        maxHeight: this.state.fullscreen || this.props.isEmbed ? "100%" : "calc(100vh - 169px)"
                    }}
                    ref={this.player}
                    width={"100%"}
                    height={this.state.fullscreen || this.props.isEmbed ? "100%" : "calc((9 / 16) * 100vw)"}
                    config={{
                        youtube: {
                            playerVars: {
                                disablekb: 1,
                                modestbranding: 1,
                                origin: window.location.hostname
                            }
                        }
                    }}
                    url={this.props.url}
                    pip={true}
                    playing={this.props.playing}
                    controls={this.props.showRootPlayer}
                    loop={this.props.loop}
                    playbackRate={this.props.playbackRate}
                    volume={this.state.volume}
                    muted={this.state.muted}
                    onReady={() => this.updateState({ready: true})}
                    onStart={() => console.log("onStart")}
                    onPlay={() => this.updateState({playing: true})}
                    onPause={() => this.updateState({playing: false})}
                    onBuffer={() => this.updateState({buffering: true})}
                    onBufferEnd={() => this.updateState({buffering: false})}
                    onSeek={(e) => console.log("onSeek", e)}
                    onEnded={() => {
                        if (this.props.loop) {
                            this.updateState({
                                played: 0,
                                playing: true
                            });
                        } else if (this.props.queueIndex + 1 < this.props.queue.length) {
                            this.props.playFromQueue(this.props.queueIndex + 1);
                        } else {
                            this.updateState({playing: false});
                        }
                    }}
                    onError={(e) => console.log("onError", e)}
                    onProgress={(progress) => {
                        // We only want to update time slider if we are not currently seeking
                        if (!this.state.seeking) {
                            this.updateState(progress);
                        }
                    }}
                    onDuration={(duration) => this.updateState({duration})}
                />
            </div>
        );
    }
}

export default Player;
