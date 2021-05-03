import React from "react";
import {ChatData} from "./Room";
import "./Chat.css";
import {Button, Form, InputGroup, Media, OverlayTrigger, Tooltip} from "react-bootstrap";
import ReactPlayer from "react-player";
import {BiAddToQueue, FiSend, IoPlay, IoPlaySkipForwardSharp} from "react-icons/all";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

interface ChatProps {
    you: string,
    owner: string,
    send: (message: string) => void,
    play: (url: string) => void,
    addQueue: (url: string) => void,
    playNext: (url: string) => void,
    history: ChatData[]
}

interface ChatState {
    message: string
}

class Chat extends React.Component<ChatProps, ChatState> {
    constructor(props: ChatProps) {
        super(props);

        this.state = {
            message: ""
        };
    }

    render() {
        return (
            <div className={"chat w-100 shadow rounded d-flex"}>
                <div className={"messages flex-grow-1"}>
                    <div className={"d-flex"}>
                        {this.props.history.map((h) => {
                            const you = this.props.you === h.user.id;
                            const canPlay = ReactPlayer.canPlay(h.message);
                            return (
                                <div key={h.time}
                                     className={"rounded mx-2 mb-2 px-2 pb-2 m" + (you ? "l-5" : "r-5")}
                                     style={{
                                         alignSelf: (you ? "end" : "start")
                                     }}>
                                    <small className={"mb-0 pb-1 text-muted text-truncate"}>
                                        {h.user.name}
                                    </small>
                                    <Media>
                                        <div className={"mr-2 rounded"}>
                                            <img
                                                width={24}
                                                height={24}
                                                src={ENDPOINT + "/icons/" + h.user.icon}
                                                alt={"User icon"}
                                            />
                                        </div>
                                        <Media.Body className={"d-flex"}>
                                        <span>
                                            {canPlay ? <a href={h.message} target={"_blank"}>
                                                {h.message}
                                            </a> : h.message}
                                        </span>
                                        </Media.Body>
                                    </Media>
                                    {canPlay ?
                                        <>
                                            <OverlayTrigger
                                                placement={"top"}
                                                overlay={
                                                    <Tooltip id={"tooltip-chat-" + h.time + "-play"}>
                                                        Play now
                                                    </Tooltip>
                                                }>
                                                <div className={"canPlay-message d-inline-flex"}>
                                                    <div className={"control-button rounded p-1 mr-1"}
                                                         onClick={() => {
                                                             this.props.play(h.message);
                                                         }}>
                                                        <IoPlay/>
                                                    </div>
                                                </div>
                                            </OverlayTrigger>
                                            <OverlayTrigger
                                                placement={"top"}
                                                overlay={
                                                    <Tooltip id={"tooltip-chat-" + h.time + "-playNext"}>
                                                        Play next
                                                    </Tooltip>
                                                }>
                                                <div className={"canPlay-message d-inline-flex"}>
                                                    <div className={"control-button rounded p-1 mr-1"}
                                                         onClick={() => {
                                                             this.props.playNext(h.message);
                                                         }}>
                                                        <IoPlaySkipForwardSharp/>
                                                    </div>
                                                </div>
                                            </OverlayTrigger>
                                            <OverlayTrigger
                                                placement={"top"}
                                                overlay={
                                                    <Tooltip id={"tooltip-chat-" + h.time + "-addQueue"}>
                                                        Add to playback queue
                                                    </Tooltip>
                                                }>
                                                <div className={"canPlay-message d-inline-flex"}>
                                                    <div className={"control-button rounded p-1 mr-1 text-success"}
                                                         onClick={() => {
                                                             this.props.addQueue(h.message);
                                                         }}>
                                                        <BiAddToQueue/>
                                                    </div>
                                                </div>
                                            </OverlayTrigger>
                                        </> :
                                        <></>
                                    }
                                </div>);
                        })}
                    </div>
                </div>
                <div className={"chat-input p-2"}>
                    <Form onSubmit={(e) => {
                        e.preventDefault();
                        if (this.state.message !== "") {
                            this.props.send(this.state.message);
                            this.setState({message: ""});
                        }
                    }}>

                        <InputGroup>
                            <Form.Control
                                value={this.state.message}
                                onChange={(e) => this.setState({
                                    message: e.target.value
                                })}
                                placeholder={"Start chatting"}
                                aria-label={"Link to media file"}
                                aria-describedby={"chat-send"}
                            />
                            <InputGroup.Append>
                                <OverlayTrigger
                                    placement={"top"}
                                    overlay={
                                        <Tooltip id={"tooltip-chat-send"}>
                                            Send message
                                        </Tooltip>
                                    }>
                                    <Button variant={"outline-success"}
                                            type={"submit"}
                                            id={"chat-send"}>
                                        <FiSend style={{marginTop: "-0.2em"}}/>
                                    </Button>
                                </OverlayTrigger>
                            </InputGroup.Append>
                        </InputGroup>
                    </Form>
                </div>
            </div>
        );
    }
}

export default Chat;
