import React from "react";
import {Col, Form, Media, Overlay, Popover, Row} from "react-bootstrap";
import {UserData} from "./Room";
import "./User.css";
import {BsPauseFill, BsPlayFill, FaCrown} from "react-icons/all";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

interface UserProps {
    user: UserData,
    duration: number,
    owner: string,
    you: string,
    update: (name: string, icon: string) => void
}

interface UserState {
    icons: string[] | null,
    popoverExpanded: boolean,
    target: HTMLDivElement | null
}

class User extends React.Component<UserProps, UserState> {
    popoverRef: React.RefObject<HTMLDivElement>;

    constructor(props: UserProps) {
        super(props);
        this.popoverRef = React.createRef();

        this.state = {
            icons: null,
            popoverExpanded: false,
            target: null
        };

        if (this.props.user.id === this.props.you) {
            fetch(ENDPOINT + "/icons.json")
                .then((res) => res.json())
                .then((icons) => {
                    this.setState({icons});
                });
        }
    }

    secondsToTime(s: number): string {
        if (isNaN(s)) {
            return "00:00";
        }

        const hours = Math.floor(s / 3600);
        const minutes = Math.floor((s - (hours * 3600)) / 60);
        const seconds = Math.floor(s - (hours * 3600) - (minutes * 60));
        if (hours === 0) {
            return (minutes > 9 ? minutes.toString() : "0" + minutes.toString()) + ":" +
                (seconds > 9 ? seconds.toString() : "0" + seconds.toString());
        }
        return (hours > 9 ? hours.toString() : "0" + hours.toString()) + ":" +
            (minutes > 9 ? minutes.toString() : "0" + minutes.toString()) + ":" +
            (seconds > 9 ? seconds.toString() : "0" + seconds.toString());
    }

    timeProgress(): string {
        return this.secondsToTime(this.props.user.played * this.props.duration) + " / " +
            this.secondsToTime(this.props.duration);
    }

    render() {
        const you = this.props.you === this.props.user.id;
        return (
            <Col className={"p-2"} xs={(you ? {order: "first"} : {})}>
                <Media className={"user rounded p-2 " + (you ? "bg-success you" : "")}>
                    {you && this.state.icons !== null ?
                        <Overlay
                            show={this.state.popoverExpanded}
                            placement={"top"}
                            container={this.popoverRef}
                            target={this.popoverRef.current}>
                            <Popover id={"change-icon-popover"}>
                                <Popover.Content>
                                    <Row className={"pl-1"}>
                                        {this.state.icons.map((icon) =>
                                            <Col key={icon}
                                                 className={"m-1 rounded user-icon"}
                                                 onClick={() => {
                                                     this.props.update(this.props.user.name, icon);
                                                     this.setState({
                                                         popoverExpanded: !this.state.popoverExpanded
                                                     });
                                                 }}
                                                 xs={"auto"}>
                                                <img
                                                    width={48}
                                                    height={48}
                                                    src={ENDPOINT + "/icons/" + icon}
                                                    alt={"User icon"}
                                                />
                                            </Col>
                                        )}
                                    </Row>
                                </Popover.Content>
                            </Popover>
                        </Overlay> : <></>
                    }
                    <div ref={this.popoverRef}
                         onClick={() => {
                             this.setState({
                                 popoverExpanded: !this.state.popoverExpanded
                             });
                         }}
                         className={"mr-2 rounded user-icon"}>
                        <img
                            width={48}
                            height={48}
                            src={ENDPOINT + "/icons/" + this.props.user.icon}
                            alt={"User icon"}
                        />
                    </div>
                    <Media.Body>
                        {you ?
                            <Form.Control
                                className={"user-edit"}
                                placeholder={"Your name"}
                                value={this.props.user.name}
                                onChange={(e) => {
                                    this.props.update(e.target.value, this.props.user.icon);
                                }}
                                type={"text"}/> :
                            <></>
                        }
                        <div className={"user-status"}>
                            <h6 className={"mb-0 pb-1 text-truncate"}>
                                {this.props.owner === this.props.user.id ?
                                    <FaCrown size={21} className={"text-warning mr-1"}
                                             style={{marginTop: "-0.5em"}}/>
                                    : <></>}
                                {this.props.user.name}
                            </h6>
                            <small>
                                {this.props.user.playing ?
                                    <BsPlayFill style={{marginTop: "-0.2em"}}/> :
                                    <BsPauseFill style={{marginTop: "-0.2em"}}/>}
                                {this.timeProgress()}
                            </small>
                        </div>
                    </Media.Body>
                </Media>
            </Col>
        );
    }
}

export default User;
