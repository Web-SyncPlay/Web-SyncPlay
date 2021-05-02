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
    IoPlaySkipForwardSharp,
    IoShareOutline,
    MdReplay
} from "react-icons/all";
import {Form} from "react-bootstrap";
import screenfull from "screenfull";
import "./Player.css";

interface PlayerProps {
    socket: Socket | null,
    url: string,
    playing: boolean,
    played: number,
    playbackRate: number,
    loop: boolean,
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
    fullscreen: boolean
}

class Player extends React.Component<PlayerProps, PlayerState> {
    player: React.RefObject<ReactPlayer>;
    interaction: boolean;
    interactionTime: number;
    private fullscreenNode: HTMLDivElement | undefined;

    constructor(props: PlayerProps) {
        super(props);
        this.player = React.createRef();
        this.interaction = false;
        this.interactionTime = 0;

        this.state = {
            volume: 0.3,
            muted: true,
            played: 0,
            loaded: 0,
            duration: 0,
            ready: false,
            buffering: false,
            seeking: false,
            fullscreen: false
        };
    }

    componentDidUpdate(prevProps: Readonly<PlayerProps>, prevState: Readonly<PlayerState>) {
        if (this.props.played) {
            if (Math.abs(prevState.played - this.props.played) * prevState.duration > 2) {
                console.log("Desynced, seeking to ", this.props.played * prevState.duration);
                this.player.current?.seekTo(this.props.played, "fraction");
                this.setState({
                    played: this.props.played
                });
            }
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

    render() {
        return (
            <div ref={(node) => this.fullscreenNode = node || undefined}>
                <div className={"player-overlay p-2"}>
                    <div className={"player-center flex-grow-1"}
                         onClick={() => {
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
                                    this.updateState({
                                        played: t
                                    });
                                }}
                                aria-label={"Progress of playback"}
                                value={this.state.played}/>
                        </div>
                        <div className={"px-1 d-flex"}>
                            <div className={"control-button rounded p-1 mx-1"}
                                 onClick={() => {
                                     if (this.state.played === 1) {
                                         this.updateState({
                                             playing: true,
                                             played: 0
                                         });
                                     } else {
                                         this.updateState({
                                             playing: !this.props.playing
                                         });
                                     }
                                 }}>
                                {this.props.playing ? <IoPause/> : (this.state.played === 1 ? <MdReplay/> : <IoPlay/>)}
                            </div>
                            {this.props.queue.length > 0 ?
                                <div className={"control-button rounded p-1 mx-1"}
                                     onClick={() => {
                                         this.props.playFromQueue(0);
                                     }}>
                                    <IoPlaySkipForwardSharp/>
                                </div> : <></>}
                            <div className={"volume-control d-flex"}>
                                <div className={"control-button rounded p-1 mx-1"}
                                     onClick={() => {
                                         if (this.state.volume === 0) {
                                             this.setState({
                                                 muted: false,
                                                 volume: 0.3
                                             });
                                         } else {
                                             this.setState({
                                                 muted: !this.state.muted
                                             });
                                         }
                                     }}>
                                    {this.state.muted || this.state.volume === 0 ? <FaVolumeMute/> :
                                        (this.state.volume > 0.6 ? <FaVolumeUp/> : <FaVolumeDown/>)}
                                </div>
                                <div className={"volume-slider"}>
                                    <Form.Control
                                        type={"range"}
                                        min={0}
                                        max={1}
                                        step={0.001}
                                        onChange={(e) => {
                                            const t = parseFloat(e.target.value);
                                            if (this.state.muted && t > 0) {
                                                this.setState({
                                                    volume: t,
                                                    muted: false
                                                });
                                            } else {
                                                this.setState({
                                                    volume: t
                                                });
                                            }
                                        }}
                                        aria-label={"Progress of playback"}
                                        value={this.state.muted ? 0 : this.state.volume}/>
                                </div>
                            </div>
                            <div className={"ml-auto d-flex"}>
                                <div className={"control-button rounded p-1 mx-1"}
                                     onClick={() => {
                                         window.open(this.props.url, "_blank");
                                     }}>
                                    <IoShareOutline/>
                                </div>
                                {screenfull.isEnabled ?
                                    <div className={"control-button rounded p-1 mx-1"}
                                         onClick={() => {
                                             if (screenfull.isEnabled) {
                                                 screenfull.toggle(this.fullscreenNode);
                                                 this.setState({fullscreen: !this.state.fullscreen});
                                             }
                                         }}>
                                        {this.state.fullscreen ? <BiExitFullscreen/> : <BiFullscreen/>}
                                    </div> : <></>
                                }
                            </div>
                        </div>
                    </div>
                </div>
                <ReactPlayer
                    className={"rounded"}
                    style={{
                        maxHeight: this.state.fullscreen ? "100%" : "calc(100vh - 169px)",
                        backgroundColor: "#000000"
                    }}
                    ref={this.player}
                    width={"100%"}
                    height={this.state.fullscreen ? "100%" : "calc((9 / 16) * 100vw)"}
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
                    controls={false}
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
                                playing: true,
                                played: 0
                            });
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
