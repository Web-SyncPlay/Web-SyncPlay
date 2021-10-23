import React from "react";
import {ChatData} from "../RoomView";
import "./Chat.css";
import {Alert, Button, Form, InputGroup, Media, OverlayTrigger, Tooltip} from "react-bootstrap";
import {BiAddToQueue, FiHelpCircle, FiSend, IoPlay, IoPlaySkipForwardSharp} from "react-icons/all";
import ControlButtonOverlay from "../player/ControlButtonOverlay";
import {canPlay} from "../../utils";


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
    message: string,
    helpDismissed: boolean
}

class Chat extends React.Component<ChatProps, ChatState> {
    constructor(props: ChatProps) {
        super(props);

        this.state = {
            helpDismissed: true,
            message: ""
        };
    }

    render() {
        return (
            <div className={"chat w-100 shadow rounded d-flex"}>
                {this.state.helpDismissed ?
                    <div style={{
                        position: "absolute",
                        right: "14px",
                        top: "14px"
                    }}>
                        <OverlayTrigger
                            placement={"top"}
                            overlay={
                                <Tooltip id={"tooltip-chat-help"}>
                                    Need help?
                                </Tooltip>
                            }>
                            <div className={"canPlay-message d-inline-flex"}>
                                <div className={"control-button rounded p-1 text-muted"}
                                     onClick={() => {
                                         this.setState({
                                             helpDismissed: false
                                         });
                                     }}>
                                    <FiHelpCircle/>
                                </div>
                            </div>
                        </OverlayTrigger>
                    </div> :
                    <Alert variant={"primary"}
                           className={"mb-0"}
                           onClose={() => this.setState({
                               helpDismissed: true
                           })}
                           dismissible>
                        Visit the
                        <ControlButtonOverlay
                            id={"tooltip-chat-help-page-tba"}
                            tooltip={"Sorry, still work in progress :/"}>
                            <a href={"#"} className={"mx-1"}>help page</a>
                        </ControlButtonOverlay>
                        for help.
                    </Alert>
                }
                <div className={"messages flex-grow-1"}>
                    <div className={"d-flex"}>
                        {this.props.history.map((h) => {
                            const you = this.props.you === h.user.id;
                            const playable = canPlay(h.message);
                            return (
                                <div key={h.time + h.message}
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
                                                src={h.user.icon}
                                                alt={"UserView icon"}
                                            />
                                        </div>
                                        <Media.Body className={"d-flex"}>
                                        <span>
                                            {playable ? <a href={h.message} target={"_blank"} rel={"noreferrer"}>
                                                {h.message}
                                            </a> : h.message}
                                        </span>
                                        </Media.Body>
                                    </Media>
                                    {playable ?
                                        <>
                                            <ControlButtonOverlay
                                                id={"tooltip-chat-" + h.time + "-play"}
                                                onClick={() => {
                                                    this.props.play(h.message);
                                                }}
                                                tooltip={"Play now"}>
                                                <IoPlay/>
                                            </ControlButtonOverlay>
                                            <ControlButtonOverlay
                                                id={"tooltip-chat-" + h.time + "-playNext"}
                                                onClick={() => {
                                                    this.props.playNext(h.message);
                                                }}
                                                tooltip={"Play next"}>
                                                <IoPlaySkipForwardSharp/>
                                            </ControlButtonOverlay>
                                            <ControlButtonOverlay
                                                className={"text-success"}
                                                id={"tooltip-chat-" + h.time + "-addQueue"}
                                                onClick={() => {
                                                    this.props.addQueue(h.message);
                                                }}
                                                tooltip={"Add to playback queue"}>
                                                <BiAddToQueue/>
                                            </ControlButtonOverlay>
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
