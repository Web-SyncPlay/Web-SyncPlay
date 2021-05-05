import React from "react";
import {Form} from "react-bootstrap";
import {IoSpeedometer} from "react-icons/all";
import "./PlaybackRate.css";
import ControlButtonOverlay from "./ControlButtonOverlay";
import ControlButton from "./ControlButton";

interface PlaybackRateProps {
    menuExpanded: (expanded: boolean) => void,
    onChange: (speed: number) => void,
    speed: number
}

interface PlaybackRateState {
    expanded: boolean
}

class PlaybackRate extends React.Component<PlaybackRateProps, PlaybackRateState> {
    constructor(props: PlaybackRateProps) {
        super(props);

        this.state = {
            expanded: false
        };
    }

    renderSpeed(speed: string) {
        return (
            <Form.Check
                checked={this.props.speed.toString() === speed}
                id={"playerControl-playbackRate-" + speed}
                key={speed}
                label={speed}
                name={"playback-rate-radio"}
                onChange={(e) => {
                    this.props.onChange(parseFloat(e.target.value));
                }}
                type={"radio"}
                value={speed}/>
        );
    }

    render() {
        return (
            <>
                {this.state.expanded ?
                    <div className={"playbackRate-overlay rounded"}>
                        <div className={"playbackRate-header rounded p-1"}>
                            <span className={"ml-1"}
                                  style={{alignSelf: "center"}}>
                                <IoSpeedometer style={{marginTop: "-0.25em"}}/> Rates
                            </span>
                            <ControlButton
                                className={"ml-auto"}
                                onClick={() => {
                                    this.props.menuExpanded(!this.state.expanded);
                                    this.setState({
                                        expanded: !this.state.expanded
                                    });
                                }}>
                                <div className={"text-white"}
                                     style={{
                                         textShadow: "0 1px 0 #fff",
                                         opacity: 0.5,
                                         fontWeight: 700
                                     }}>
                                    <span aria-hidden="true">×</span>
                                    <span className="sr-only">Close</span>
                                </div>
                            </ControlButton>
                        </div>
                        <Form className={"playbackRate-body p-2"}>
                            {["0.25", "0.5", "0.75", "1", "1.25", "1.5", "1.75", "2", "3"]
                                .map((speed) => this.renderSpeed(speed))}
                        </Form>
                    </div> : <></>
                }
                <ControlButtonOverlay
                    className={"d-none d-sm-flex"}
                    id={"playerControl-overlay-playbackRate"}
                    onClick={() => {
                        this.props.menuExpanded(!this.state.expanded);
                        this.setState({
                            expanded: !this.state.expanded
                        });
                    }}
                    tooltip={"Playback rates"}>
                    <IoSpeedometer/>
                </ControlButtonOverlay>
            </>
        );
    }
}

export default PlaybackRate;
