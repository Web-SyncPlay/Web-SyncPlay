import React from "react";
import screenfull from "screenfull";
import ControlButtonOverlay from "./ControlButtonOverlay";
import {
    BiExitFullscreen,
    BiFullscreen,
    BiWindowClose,
    BiWindowOpen,
    IoPause,
    IoPauseCircleOutline,
    IoPlay,
    IoPlayCircleOutline,
    IoPlaySkipBackSharp,
    IoPlaySkipForwardSharp,
    IoShareOutline,
    MdReplay
} from "react-icons/all";
import VolumeControl from "./VolumeControl";
import ControlButton from "./ControlButton";
import UserView from "../UserView";
import PlaybackRate from "./PlaybackRate";
import ReactPlayer from "react-player";
import {getUrl, PlayURL} from "../queue/QueueItemView";
import InteractionHandler from "./InteractionHandler";
import Slider from "./Slider";

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
    updateState: (data: any, interaction?: boolean) => void,
    url: string | PlayURL,
    volume: number
}

interface PlayerControlsState {
    controlsHidden: boolean,
    isTouch: boolean,
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
            isTouch: false,
            menuExpanded: false,
            showTimePlayed: true,
            playerPoppedOut: false
        };
    }

    updateState(data: any, interaction: boolean = false) {
        this.props.updateState(data, interaction);
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

    mouseMoved(touch: boolean | null = null) {
        this.lastMouseMove = new Date().getTime();
        if (touch !== null) {
            this.setState({
                isTouch: touch
            });
        }

        setTimeout(() => {
            if (new Date().getTime() - this.lastMouseMove > (touch ? 3150 : 1550)) {
                this.setState({
                    controlsHidden: true
                });
            }
        }, touch ? 3200 : 1600);
    }

    showControlsAction(touch: boolean | null = null) {
        if (this.state.controlsHidden) {
            this.setState({controlsHidden: false});
        }
        this.mouseMoved(touch);
    }

    checkPopout() {
        if (this.playerPopup) {
            if (!this.playerPopup.closed) {
                // check every 400ms if popout is still open
                setTimeout(this.checkPopout.bind(this), 400);
            } else {
                this.setState({
                    playerPoppedOut: false
                });
            }
        }
    }

    render() {
        return (
            <InteractionHandler
                className={"player-overlay p-2" + (this.state.controlsHidden && !this.state.menuExpanded ?
                    " hide" : "") + (this.state.isTouch ? " touch" : "")}
                onMove={(e, touch) => {
                    this.showControlsAction(touch);
                }}>
                {this.props.controlsHidden ? <></> :
                    <>
                        <InteractionHandler
                            className={"player-center flex-grow-1"}
                            onClick={(e, touch) => {
                                if (this.interaction) {
                                    this.interaction = false;
                                    if (screenfull.isEnabled) {
                                        screenfull.toggle(this.props.fullscreenNode);
                                        this.updateState({fullscreen: !this.props.fullscreen});
                                    }
                                } else if (touch) {
                                    this.setState({controlsHidden: !this.state.controlsHidden});
                                }
                                this.interact();
                                this.mouseMoved(touch);
                            }}>
                            <InteractionHandler
                                className={"big-play-button"}
                                onClick={(e, touch) => {
                                    if (!this.state.controlsHidden) {
                                        this.updateState({
                                            playing: !this.props.playing
                                        }, true);
                                    }
                                    this.showControlsAction(touch);
                                }}>
                                {this.props.playing ?
                                    <IoPauseCircleOutline/> :
                                    <IoPlayCircleOutline/>}
                            </InteractionHandler>
                        </InteractionHandler>
                        <div className={"player-controls px-2"}>
                            <Slider
                                ariaLabel={"Progress of playback"}
                                className={"player-progress"}
                                played={this.props.played}
                                updateSeek={(t) => {
                                    this.props.player.current?.seekTo(t);
                                    this.updateState({
                                        interaction: true,
                                        played: t
                                    });
                                    this.mouseMoved();
                                }}/>
                            <div className={"px-1 pb-1 d-flex"}>
                                {0 < this.props.queueIndex ?
                                    <ControlButtonOverlay
                                        className={"d-none d-sm-block"}
                                        id={"playerControl-previous"}
                                        onClick={(e, touch) => {
                                            if (!this.state.controlsHidden) {
                                                this.props.playFromQueue(this.props.queueIndex - 1);
                                            }
                                            this.showControlsAction(touch);
                                        }}
                                        tooltip={"Play previous"}>
                                        <IoPlaySkipBackSharp/>
                                    </ControlButtonOverlay> : <></>}
                                <ControlButtonOverlay
                                    id={"playerControl-play"}
                                    onClick={(e, touch) => {
                                        if (!this.state.controlsHidden) {
                                            if (this.playEnded()) {
                                                this.updateState({
                                                    played: 0,
                                                    playing: true
                                                }, true);
                                            } else {
                                                this.updateState({
                                                    playing: !this.props.playing
                                                }, true);
                                            }
                                        }
                                        this.showControlsAction(touch);
                                    }}
                                    tooltip={this.props.playing ? "Pause" :
                                        (this.playEnded() ? "Restart" : "Play")}>
                                    {this.props.playing ? <IoPause/> : (this.playEnded() ? <MdReplay/> :
                                        <IoPlay/>)}
                                </ControlButtonOverlay>
                                {this.props.queue.length > this.props.queueIndex + 1 && this.props.queueIndex > -1 ?
                                    <ControlButtonOverlay
                                        id={"playerControl-next"}
                                        onClick={(e, touch) => {
                                            if (!this.state.controlsHidden) {
                                                this.props.playFromQueue(this.props.queueIndex + 1);
                                            }
                                            this.showControlsAction(touch);
                                        }}
                                        tooltip={"Play next"}>
                                        <IoPlaySkipForwardSharp/>
                                    </ControlButtonOverlay> : <></>}
                                <VolumeControl
                                    controlsHidden={this.state.controlsHidden}
                                    muted={this.props.muted}
                                    update={(muted, volume) => {
                                        this.showControlsAction();
                                        this.updateState({
                                            muted,
                                            volume
                                        });
                                    }}
                                    volume={this.props.volume}
                                />

                                <div className={"ml-auto d-flex"}>
                                    <ControlButton
                                        onClick={(e, touch) => {
                                            if (!this.state.controlsHidden) {
                                                this.setState({showTimePlayed: !this.state.showTimePlayed});
                                            }
                                            this.showControlsAction(touch);
                                        }}>
                                        {(this.state.showTimePlayed ? UserView.secondsToTime(this.props.played * this.props.duration) :
                                            "-" + UserView.secondsToTime((1 - this.props.played) * this.props.duration)) + " / " +
                                        UserView.secondsToTime(this.props.duration)}
                                    </ControlButton>
                                    {!this.props.isEmbed ?
                                        <>
                                            <ControlButtonOverlay
                                                className={"d-none d-sm-block"}
                                                id={"playerControl-share"}
                                                onClick={(e, touch) => {
                                                    if (!this.state.controlsHidden) {
                                                        window.open(getUrl(this.props.url), "_blank");
                                                    }
                                                    this.showControlsAction(touch);
                                                }}
                                                tooltip={"Open source in new tab"}>
                                                <IoShareOutline/>
                                            </ControlButtonOverlay>
                                            {this.state.isTouch ? <></> :
                                                <ControlButtonOverlay
                                                    className={"d-none d-lg-block"}
                                                    id={"playerControl-pop-out"}
                                                    onClick={(e, touch) => {
                                                        if (!this.state.controlsHidden) {
                                                            if (!this.state.playerPoppedOut) {
                                                                this.playerPopup = window.open("/embed/player/" + this.props.roomId,
                                                                    "Room " + this.props.roomId + " Popout",
                                                                    "width=854,height=480," +
                                                                    "toolbar=false,location=false," +
                                                                    "status=false,menubar=false," +
                                                                    "dependent=true,resizable=true");
                                                                setTimeout(this.checkPopout.bind(this), 400);
                                                            } else {
                                                                if (this.playerPopup) {
                                                                    this.playerPopup.close();
                                                                }
                                                            }

                                                            this.setState({
                                                                playerPoppedOut: !this.state.playerPoppedOut
                                                            });
                                                        }
                                                        this.showControlsAction(touch);
                                                    }}
                                                    tooltip={this.state.playerPoppedOut ?
                                                        "Close popup" : "Open in popup"}>
                                                    {this.state.playerPoppedOut ?
                                                        <BiWindowClose/> : <BiWindowOpen/>}
                                                </ControlButtonOverlay>
                                            }
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
                                            });
                                            this.showControlsAction();
                                        }}
                                        speed={this.props.playbackRate}/>
                                    {screenfull.isEnabled ?
                                        <ControlButtonOverlay
                                            id={"playerControl-fullscreen"}
                                            onClick={(e, touch) => {
                                                if (screenfull.isEnabled) {
                                                    screenfull.toggle(this.props.fullscreenNode);
                                                    this.updateState({fullscreen: !this.props.fullscreen});
                                                }
                                                this.showControlsAction(touch);
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
            </InteractionHandler>
        );
    }
}

export default PlayerControls;
