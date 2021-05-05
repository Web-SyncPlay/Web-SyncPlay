import React from "react";
import {Form, OverlayTrigger, Popover} from "react-bootstrap";
import {IoSpeedometer} from "react-icons/all";
import "./PlaybackRate.css";
import ControlButtonOverlay from "./ControlButtonOverlay";

interface PlaybackRateProps {
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
                className={"my-1"}
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
            <OverlayTrigger
                trigger={"click"}
                placement={"top"}
                overlay={
                    <Popover id={"playerControl-playbackRate"}>
                        <Popover.Title as="h3">
                            <IoSpeedometer style={{marginTop: "-0.25em"}}/> Rates
                        </Popover.Title>
                        <Popover.Content>
                            <Form>
                                {["0.25", "0.5", "0.75", "1", "1.25", "1.5", "1.75", "2", "3"]
                                    .map((speed) => this.renderSpeed(speed))}
                            </Form>
                        </Popover.Content>
                    </Popover>
                }>
                <div className={"d-none d-sm-flex"}>
                    <ControlButtonOverlay
                        id={"playerControl-overlay-playbackRate"}
                        onClick={() => {
                            this.setState({
                                expanded: !this.state.expanded
                            });
                        }}
                        tooltip={"Playback rates"}>
                        <IoSpeedometer/>
                    </ControlButtonOverlay>
                </div>
            </OverlayTrigger>
        );
    }
}

export default PlaybackRate;
