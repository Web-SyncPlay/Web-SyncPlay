import React from "react";
import {Col, Media} from "react-bootstrap";
import {UserData} from "./Room";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

interface UserProps {
    user: UserData
}

class User extends React.Component<UserProps> {
    secondsToTime(s: number): string {
        const hours = Math.floor(s / 3600);
        const minutes = Math.floor((s - (hours * 3600)) / 60);
        const seconds = Math.floor(s - (hours * 3600) - (minutes * 60));
        if (hours === 0) {
            return (minutes > 10 ? minutes.toString() : "0" + minutes.toString()) + ':' +
                (seconds > 10 ? seconds.toString() : "0" + seconds.toString());
        }
        return (hours > 10 ? hours.toString() : "0" + hours.toString()) + ':' +
            (minutes > 10 ? minutes.toString() : "0" + minutes.toString()) + ':' +
            (seconds > 10 ? seconds.toString() : "0" + seconds.toString());
    }

    timeProgress(): string {
        return this.secondsToTime(this.props.user.played * this.props.user.duration) + " / " +
            this.secondsToTime(this.props.user.duration);
    }

    render() {
        return (
            <Col>
                <Media>
                    <img
                        width={48}
                        height={48}
                        className="mr-3"
                        src={ENDPOINT + "/icons/" + this.props.user.icon}
                        alt="User icon"
                    />
                    <Media.Body>
                        <h5>
                            {this.props.user.name}
                        </h5>
                        <p>
                            {this.props.user.playing ? "Playing" : "Paused"} at {this.timeProgress()} at {/*this.props.user.playbackRate.toString()*/} speed
                        </p>
                    </Media.Body>
                </Media>
            </Col>
        );
    }
}

export default User;
