import React from "react";
import socketIOClient, {Socket} from "socket.io-client";
import {Button, ButtonGroup, Col, Row} from "react-bootstrap";
import ReactPlayer from "react-player";
import "./Room.css";
import {BsPauseFill, BsPlayFill, FaPlay, FaVolumeMute, FaVolumeUp, ImLoop} from "react-icons/all";
import {Helmet} from "react-helmet";

const ENDPOINT = "http://localhost:8081";

interface RoomProps {
    roomId: string
}

interface RoomState {
    socket: Socket,
    url: string,
    playing: boolean,
    volume: number,
    muted: boolean,
    played: number,
    loaded: number,
    duration: number,
    playbackRate: number,
    loop: boolean,
    seeking: boolean
}

class Room extends React.Component<RoomProps, RoomState> {
    player: React.RefObject<ReactPlayer>;

    constructor(props: RoomProps) {
        super(props);
        this.player = React.createRef<ReactPlayer>();

        this.state = {
            socket: socketIOClient(ENDPOINT),
            url: "https://youtu.be/Bi11Iid2hmo",
            playing: true,
            volume: 0.3,
            muted: false,
            played: 0,
            loaded: 0,
            duration: 0,
            playbackRate: 1.0,
            loop: false,
            seeking: false
        };

        this.state.socket.on("", data => {

        });
    }

    changeToURL(url: string) {
        if (ReactPlayer.canPlay(url)) {
            this.load(url);
        } else {
            console.log("Error, cannot play url:", url);
        }
    }

    load(url: string) {
        this.setState({
            url,
            played: 0,
            loaded: 0,
            playing: true
        })
    }

    handlePlayPause() {
        this.setState({playing: !this.state.playing})
    }

    handleToggleLoop() {
        this.setState({loop: !this.state.loop})
    }

    handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
        this.setState({volume: parseFloat(e.target.value)})
    }

    handleToggleMuted() {
        this.setState({muted: !this.state.muted})
    }

    handleSetPlaybackRate(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
        this.setState({playbackRate: parseFloat(e.target.value)})
    }

    handlePlay() {
        console.log('onPlay')
        this.setState({playing: true})
    }

    handlePause() {
        console.log('onPause')
        this.setState({playing: false})
    }

    handleSeekMouseDown(e: any) {
        this.setState({seeking: true})
    }

    handleSeekChange(e: any) {
        this.setState({played: parseFloat(e.target.value)})
    }

    handleSeekMouseUp(e: any) {
        this.setState({seeking: false})
        this.player.current?.seekTo(parseFloat(e.target.value))
    }

    handleProgress(state: any) {
        console.log('onProgress', state)
        // We only want to update time slider if we are not currently seeking
        if (!this.state.seeking) {
            this.setState(state)
        }
    }

    handleEnded() {
        console.log('onEnded')
        this.setState({playing: this.state.loop})
    }

    handleDuration(duration: number) {
        console.log('onDuration', duration)
        this.setState({duration: duration})
    }


    render() {
        return (
            <Row className={"m-0 mb-2 px-4"}>
                <Helmet>
                    <title>
                        Room {this.props.roomId} | {this.state.url}
                    </title>
                    <link rel="canonical" href={"/room/" + this.props.roomId}/>
                </Helmet>
                <Col className={"p-0"}>
                    <ReactPlayer
                        style={{
                            maxHeight: "calc(100vh - 169px)",
                            minHeight: "480px"
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
                        onReady={() => console.log('onReady')}
                        onStart={() => console.log('onStart')}
                        onPlay={this.handlePlay.bind(this)}
                        onPause={this.handlePause.bind(this)}
                        onBuffer={() => console.log('onBuffer')}
                        onSeek={e => console.log('onSeek', e)}
                        onEnded={this.handleEnded.bind(this)}
                        onError={e => console.log('onError', e)}
                        onProgress={this.handleProgress.bind(this)}
                        onDuration={this.handleDuration.bind(this)}
                    />
                </Col>
                <Col xs={"auto"} className={"p-0"}>
                    <ButtonGroup vertical>
                        <Button onClick={() => this.setState({playing: !this.state.playing})}
                                variant={"outline-secondary"}>
                            {this.state.playing ? (<BsPauseFill/>) : (<BsPlayFill/>)}
                        </Button>
                        <Button onClick={() => this.setState({muted: !this.state.muted})}
                                variant={"outline-secondary"}>
                            {this.state.muted ? (<FaVolumeMute/>) : (<FaVolumeUp/>)}
                        </Button>
                        <Button onClick={() => this.setState({loop: !this.state.loop})}
                                variant={"outline-secondary"}>
                            {this.state.loop ? (<ImLoop/>) : (<FaPlay/>)}
                        </Button>
                    </ButtonGroup>
                </Col>
            </Row>
        );
    }
}

export default Room;
