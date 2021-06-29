import React from "react";
import {Col, Form, Media, Overlay, Popover, Row} from "react-bootstrap";
import {UserData} from "./RoomView";
import "./User.css";
import {FaCrown, FaVolumeMute, GiTvRemote, ImEmbed2, IoGameController, IoPause, IoPlay} from "react-icons/all";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://192.168.178.57:8081";

interface UserProps {
    user: UserData,
    duration: number,
    owner: string,
    you: string,
    update: (name: string, icon: string) => void
}

interface UserState {
    icons: string[],
    popoverExpanded: boolean,
    target: HTMLDivElement | null
}

class UserView extends React.Component<UserProps, UserState> {
    popoverRef: React.RefObject<HTMLDivElement>;

    constructor(props: UserProps) {
        super(props);
        this.popoverRef = React.createRef();

        this.state = {
            icons: [],
            popoverExpanded: false,
            target: null
        };
    }

    componentDidMount() {
        if (this.props.user.id === this.props.you) {
            fetch(ENDPOINT + "/icons.json")
                .then((res) => res.json())
                .then((icons) => {
                    this.setState({icons});
                });
        }
    }

    static secondsToTime(s: number): string {
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
        return UserView.secondsToTime(this.props.user.played * this.props.duration) + " / " +
            UserView.secondsToTime(this.props.duration);
    }

    renderChangeIcon() {
        return (
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
                                         if (this.props.user.name) {
                                             this.props.update(this.props.user.name, icon);
                                         }
                                         this.setState({
                                             popoverExpanded: !this.state.popoverExpanded
                                         });
                                     }}
                                     xs={"auto"}>
                                    <img
                                        width={48}
                                        height={48}
                                        src={ENDPOINT + icon}
                                        alt={"UserView icon"}
                                    />
                                </Col>
                            )}
                        </Row>
                    </Popover.Content>
                </Popover>
            </Overlay>
        );
    }

    render() {
        const you = this.props.you === this.props.user.id;
        const embed = this.props.user.embed;
        const controller = this.props.user.controller || false;
        // @ts-ignore
        return (
            <Col className={"p-2"} xs={(you ? {order: "first"} : {})}>
                <Media className={"user shadow rounded p-2 " +
                (you ? "bg-success you" : "") +
                (embed || controller ? "bg-dark" : "")}>
                    {!embed ?
                        <>
                            {you && this.state.icons !== null ?
                                this.renderChangeIcon() : <></>}
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
                                    src={this.props.user.icon}
                                    alt={"UserView icon"}/>
                            </div>
                            <Media.Body>
                                {you ?
                                    <Form.Control
                                        className={"user-edit"}
                                        placeholder={"Your name"}
                                        value={this.props.user.name}
                                        onChange={(e) => {
                                            if (this.props.user.icon) {
                                                this.props.update(e.target.value, this.props.user.icon);
                                            }
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
                                    <div className={"d-flex"}>
                                        <span>
                                            <span style={{marginRight: "0.2em"}}>
                                            {this.props.user.playing ?
                                                <IoPlay style={{marginTop: "-0.2em"}}/> :
                                                <IoPause style={{marginTop: "-0.2em"}}/>}
                                            </span>
                                            {this.timeProgress()}
                                        </span>
                                        <span className={"ml-auto"}>
                                            {this.props.user.muted || this.props.user.volume === 0 ?
                                                <FaVolumeMute style={{marginTop: "-0.2em"}}/> : <></>
                                            }
                                        </span>
                                    </div>
                                </div>
                            </Media.Body>
                        </>
                        :
                        <Media.Body>
                            <div className={"user-status"}>
                                <h6 className={"mb-0 pb-1 text-truncate"}>
                                    {this.props.owner === this.props.user.id ?
                                        <FaCrown size={21} className={"text-warning mr-1"}
                                                 style={{marginTop: "-0.5em"}}/>
                                        : <></>}
                                    {controller ? <>
                                            <GiTvRemote className={"text-warning"}
                                                        style={{marginTop: "-0.25em"}}/>
                                            <span className={"mx-1"}>Controller embed</span>
                                            <GiTvRemote className={"text-warning"}
                                                        style={{marginTop: "-0.25em"}}/>
                                        </> :
                                        <>
                                            <ImEmbed2 className={"text-warning"}
                                                      style={{marginTop: "-0.25em"}}/>
                                            <span className={"mx-1"}>Embedded player</span>
                                            <ImEmbed2 className={"text-warning"}
                                                      style={{marginTop: "-0.25em"}}/>
                                        </>
                                    }
                                </h6>
                                <div className={"d-flex"}>
                                    {controller ?
                                        <div>
                                            Remote controlling <IoGameController
                                            className={"text-secondary"}/> this room
                                        </div> :
                                        <>
                                            <span>
                                                <span style={{marginRight: "0.2em"}}>
                                                {this.props.user.playing ?
                                                    <IoPlay style={{marginTop: "-0.2em"}}/> :
                                                    <IoPause style={{marginTop: "-0.2em"}}/>}
                                                </span>
                                                {this.timeProgress()}
                                            </span>
                                            <span className={"ml-auto"}>
                                                {this.props.user.muted || this.props.user.volume === 0 ?
                                                    <FaVolumeMute style={{marginTop: "-0.2em"}}/> : <></>
                                                }
                                            </span>
                                        </>
                                    }
                                </div>
                            </div>
                        </Media.Body>
                    }
                </Media>
            </Col>
        );
    }

}

export default UserView;
