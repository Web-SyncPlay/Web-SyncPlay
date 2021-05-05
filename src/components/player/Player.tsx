import React from "react";
import ReactPlayer from "react-player";
import {Socket} from "socket.io-client";
import "./Player.css";
import PlayerControls from "./PlayerControls";

const LEFT_MOUSE_CLICK = 0;

interface PlayerProps {
    controlsHidden: boolean,
    showRootPlayer: boolean,
    id: string,
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
    buffering: boolean,
    duration: number,
    fullscreen: boolean,
    loaded: number,
    muted: boolean,
    playbackRate: number,
    played: number,
    playerPoppedOut: boolean,
    ready: boolean,
    seeking: boolean,
    volume: number
}

class Player extends React.Component<PlayerProps, PlayerState> {
    player: React.RefObject<ReactPlayer>;
    private fullscreenNode: HTMLDivElement | undefined;

    constructor(props: PlayerProps) {
        super(props);
        this.player = React.createRef();

        this.state = {
            buffering: false,
            duration: 0,
            fullscreen: false,
            loaded: 0,
            muted: true,
            playbackRate: this.props.playbackRate,
            played: 0,
            playerPoppedOut: false,
            ready: false,
            seeking: false,
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
            if (this.player.current) {
                this.player.current.seekTo(this.props.played, "fraction");
            }
            this.setState({
                played: this.props.played
            });
        }
    }

    updateState(data: any) {
        if (this.props.socket) {
            this.props.socket.emit("update", data);
        }
        window.parent.postMessage({
            type: "sync-player",
            data
        }, "*");
        this.setState(data);
    }

    render() {
        return (
            <div className={"player"}
                 ref={(node) => this.fullscreenNode = node || undefined}>
                {this.props.showRootPlayer ? <></> :
                    <PlayerControls
                        controlsHidden={this.props.controlsHidden}
                        duration={this.state.duration}
                        fullscreen={this.state.fullscreen}
                        fullscreenNode={this.fullscreenNode}
                        isEmbed={this.props.isEmbed}
                        muted={this.state.muted}
                        playbackRate={this.state.playbackRate}
                        played={this.state.played}
                        player={this.player}
                        playFromQueue={this.props.playFromQueue}
                        playing={this.props.playing}
                        queue={this.props.queue}
                        queueIndex={this.props.queueIndex}
                        roomId={this.props.id}
                        updateState={this.updateState.bind(this)}
                        url={this.props.url}
                        volume={this.state.volume}/>
                }
                <ReactPlayer
                    style={{
                        backgroundColor: "#000000",
                        overflow: "hidden",
                        maxHeight: this.state.fullscreen || this.props.isEmbed ? "100vh" : "calc(100vh - 169px)",
                        visibility: this.state.playerPoppedOut ? "hidden" : "visible"
                    }}
                    ref={this.player}
                    width={"100%"}
                    height={this.state.fullscreen || this.props.isEmbed ? "100vh" : "calc((9 / 16) * 100vw)"}
                    config={{
                        youtube: {
                            playerVars: {
                                disablekb: 1,
                                modestbranding: 1,
                                origin: window.location.host
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
