import React from "react";
import {Col, Form, Media} from "react-bootstrap";
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
    mouse: boolean
}

class User extends React.Component<UserProps, UserState> {
    constructor(props: UserProps) {
        super(props);

        this.state = {
            mouse: false
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
            return (minutes > 9 ? minutes.toString() : "0" + minutes.toString()) + ':' +
                (seconds > 9 ? seconds.toString() : "0" + seconds.toString());
        }
        return (hours > 9 ? hours.toString() : "0" + hours.toString()) + ':' +
            (minutes > 9 ? minutes.toString() : "0" + minutes.toString()) + ':' +
            (seconds > 9 ? seconds.toString() : "0" + seconds.toString());
    }

    timeProgress(): string {
        return this.secondsToTime(this.props.user.played * this.props.duration) + " / " +
            this.secondsToTime(this.props.duration);
    }

    render() {
        const you = this.props.you === this.props.user.id;
        return (
            <Col className={"p-2"}>
                <Media
                    className={"user rounded p-2 " + (you ? "bg-success" : "")}
                    onMouseEnter={() => this.setState({mouse: true})}
                    onMouseLeave={() => this.setState({mouse: false})}>
                    <div className={"mr-2 rounded"}>
                        <img
                            width={48}
                            height={48}
                            src={ENDPOINT + "/icons/" + this.props.user.icon}
                            alt={"User icon"}
                        />
                    </div>
                    <Media.Body>
                        {you && this.state.mouse ?
                            <Form.Control
                                placeholder={"Your name"}
                                value={this.props.user.name}
                                onChange={(e) => {
                                    this.props.update(e.target.value, this.props.user.icon);
                                }}
                                type={"text"}/> :
                            <>
                                <h6 onClick={() => this.setState({mouse: true})}
                                    className={"mb-0 pb-1 text-truncate"}>
                                    {this.props.owner === this.props.user.id ?
                                        <FaCrown size={21} className={"text-warning mr-1"}
                                                 style={{marginTop: "-0.5em"}}/>
                                        : <></>}
                                    {this.props.user.name}
                                </h6>
                                <small>
                                    {this.props.user.playing ?
                                        <BsPlayFill style={{marginTop: "-0.2em"}}/> :
                                        <BsPauseFill style={{marginTop: "-0.2em"}}/>}{this.timeProgress()}
                                </small>
                            </>
                        }
                    </Media.Body>
                </Media>
            </Col>
        );
    }
}

export default User;
