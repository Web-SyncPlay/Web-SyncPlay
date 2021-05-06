import React from "react";
import screenfull from "screenfull";
import {Form} from "react-bootstrap";
import ControlButtonOverlay from "./ControlButtonOverlay";
import {
    BiExitFullscreen,
    BiFullscreen,
    BiWindowClose,
    BiWindowOpen,
    IoPause,
    IoPlay,
    IoPlaySkipBackSharp,
    IoPlaySkipForwardSharp,
    IoShareOutline,
    MdReplay
} from "react-icons/all";
import VolumeControl from "./VolumeControl";
import ControlButton, {LEFT_MOUSE_CLICK} from "./ControlButton";
import User from "../User";
import PlaybackRate from "./PlaybackRate";
import ReactPlayer from "react-player";
import "./Slider.css";
import {getUrl, PlayURL} from "../queue/QueueItem";

interface PlayerControlsProps {
    controlsHidden: boolean,
    duration: number,
    endInteract: () => void,
    fullscreen: boolean,
    fullscreenNode: HTMLDivElement | undefined,
    isEmbed: boolean,
    muted: boolean,
    playbackRate: number,
    played: number,
    player: React.RefObject<ReactPlayer>,
    playFromQueue: (index: number) => void,
    playing: boolean,
    queue: string[] | PlayURL[],
    queueIndex: number,
    roomId: string,
    startInteract: () => void,
    updateState: (data: any) => void,
    url: string | PlayURL,
    volume: number
}

interface PlayerControlsState {
    controlsHidden: boolean,
    menuExpanded: boolean,
    showTimePlayed: boolean,
    playerPoppedOut: boolean
}

class PlayerControls extends React.Component<PlayerControlsProps, PlayerControlsState> {
    lastMouseMove: number;
    interaction: boolean;
    interactionTime: number;
    private playerPopup: Window | null;

    constructor(props: PlayerControlsProps) {
        super(props);
        this.lastMouseMove = 0;
        this.interaction = false;
        this.interactionTime = new Date().getTime();
        this.playerPopup = null;

        this.state = {
            controlsHidden: false,
            menuExpanded: false,
            showTimePlayed: true,
            playerPoppedOut: false
        };
    }

    updateState(data: any) {
        data.interaction = this.interaction;
        this.props.updateState(data);
    }

    playEnded() {
        return !this.props.playing && ((1 - this.props.played) * this.props.duration < 1);
    }

    interact() {
        this.interaction = true;
        this.props.startInteract();
        this.interactionTime = new Date().getTime();
        console.debug("user interaction happened at time", this.interactionTime);
        setTimeout(() => {
            if (new Date().getTime() - this.interactionTime > 250) {
                this.interaction = false;
                this.props.endInteract();
            }
        }, 300);
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
            <div
                className={"player-overlay p-2" + (this.state.controlsHidden && !this.state.menuExpanded ?
                    " hide" : "")}
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
                                         screenfull.toggle(this.props.fullscreenNode);
                                         this.updateState({fullscreen: !this.props.fullscreen});
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
                                         screenfull.toggle(this.props.fullscreenNode);
                                         this.updateState({fullscreen: !this.props.fullscreen});
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
                                        this.props.player.current?.seekTo(t);
                                        e.target.style.setProperty("--value", (t * 100) + "%");
                                        this.updateState({
                                            played: t
                                        });
                                    }}
                                    style={{"--value": (this.props.played * 100) + "%"} as React.CSSProperties}
                                    aria-label={"Progress of playback"}
                                    value={this.props.played}/>
                            </div>
                            <div className={"px-1 pb-1 d-flex"}>
                                {0 < this.props.queueIndex ?
                                    <ControlButtonOverlay
                                        className={"d-none d-sm-block"}
                                        id={"playerControl-previous"}
                                        onClick={() => {
                                            if (!this.state.controlsHidden) {
                                                this.props.playFromQueue(this.props.queueIndex - 1);
                                            }
                                        }}
                                        tooltip={"Play previous"}>
                                        <IoPlaySkipBackSharp/>
                                    </ControlButtonOverlay> : <></>}
                                <ControlButtonOverlay
                                    id={"playerControl-play"}
                                    onClick={() => {
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
                                    tooltip={this.props.playing ? "Pause" :
                                        (this.playEnded() ? "Restart" : "Play")}>
                                    {this.props.playing ? <IoPause/> : (this.playEnded() ? <MdReplay/> :
                                        <IoPlay/>)}
                                </ControlButtonOverlay>
                                {this.props.queue.length > this.props.queueIndex + 1 && this.props.queueIndex > -1 ?
                                    <ControlButtonOverlay
                                        id={"playerControl-next"}
                                        onClick={() => {
                                            if (!this.state.controlsHidden) {
                                                this.props.playFromQueue(this.props.queueIndex + 1);
                                            }
                                        }}
                                        tooltip={"Play next"}>
                                        <IoPlaySkipForwardSharp/>
                                    </ControlButtonOverlay> : <></>}
                                <VolumeControl
                                    controlsHidden={this.state.controlsHidden}
                                    muted={this.props.muted}
                                    update={(muted, volume) => {
                                        this.updateState({
                                            muted,
                                            volume
                                        });
                                    }}
                                    volume={this.props.volume}
                                />

                                <div className={"ml-auto d-flex"}>
                                    <ControlButton
                                        onClick={() => {
                                            if (!this.state.controlsHidden) {
                                                this.setState({showTimePlayed: !this.state.showTimePlayed});
                                            }
                                        }}>
                                        {(this.state.showTimePlayed ? User.secondsToTime(this.props.played * this.props.duration) :
                                            "-" + User.secondsToTime((1 - this.props.played) * this.props.duration)) + " / " +
                                        User.secondsToTime(this.props.duration)}
                                    </ControlButton>
                                    {!this.props.isEmbed ?
                                        <>
                                            <ControlButtonOverlay
                                                className={"d-none d-sm-block"}
                                                id={"playerControl-share"}
                                                onClick={() => {
                                                    if (!this.state.controlsHidden) {
                                                        window.open(getUrl(this.props.url), "_blank");
                                                    }
                                                }}
                                                tooltip={"Open source in new tab"}>
                                                <IoShareOutline/>
                                            </ControlButtonOverlay>
                                            <ControlButtonOverlay
                                                className={"d-none d-lg-block"}
                                                id={"playerControl-pop-out"}
                                                onClick={() => {
                                                    if (!this.state.controlsHidden) {
                                                        if (!this.state.playerPoppedOut) {
                                                            this.playerPopup = window.open("/embed/player/" + this.props.roomId,
                                                                "Room " + this.props.roomId + " Popout",
                                                                "width=854,height=480," +
                                                                "toolbar=false,location=false," +
                                                                "status=false,menubar=false," +
                                                                "dependent=true,resizable=true");
                                                            this.playerPopup?.addEventListener("unload", (e) => {
                                                                if (this.playerPopup?.closed) {
                                                                    this.setState({
                                                                        playerPoppedOut: false
                                                                    });
                                                                }
                                                            });
                                                        } else {
                                                            if (this.playerPopup) {
                                                                this.playerPopup.close();
                                                            }
                                                        }

                                                        this.setState({
                                                            playerPoppedOut: !this.state.playerPoppedOut
                                                        });
                                                    }
                                                }}
                                                tooltip={this.state.playerPoppedOut ?
                                                    "Close popup" : "Open in popup"}>
                                                {this.state.playerPoppedOut ?
                                                    <BiWindowClose/> : <BiWindowOpen/>}
                                            </ControlButtonOverlay>
                                        </> : <></>
                                    }
                                    <PlaybackRate
                                        menuExpanded={(expanded) => {
                                            this.setState({
                                                menuExpanded: expanded
                                            });
                                        }}
                                        onChange={(speed) => {
                                            this.updateState({
                                                playbackRate: speed
                                            })
                                        }}
                                        speed={this.props.playbackRate}/>
                                    {screenfull.isEnabled ?
                                        <ControlButtonOverlay
                                            id={"playerControl-fullscreen"}
                                            onClick={() => {
                                                if (screenfull.isEnabled) {
                                                    screenfull.toggle(this.props.fullscreenNode);
                                                    this.updateState({fullscreen: !this.props.fullscreen});
                                                }
                                            }}
                                            tooltip={(this.props.fullscreen ? "Exit" : "Enter") + " fullscreen"}>
                                            {this.props.fullscreen ? <BiExitFullscreen/> : <BiFullscreen/>}
                                        </ControlButtonOverlay> : <></>
                                    }
                                </div>
                            </div>
                        </div>
                    </>
                }
            </div>
        );
    }
}

export default PlayerControls;
