import React from "react";
import ControlButtonOverlay from "./ControlButtonOverlay";
import {FaVolumeDown, FaVolumeMute, FaVolumeUp} from "react-icons/all";
import {Form} from "react-bootstrap";
import "./VolumeControl.css";
import "./Slider.css";

interface VolumeControlProps {
    controlsHidden: boolean,
    muted: boolean,
    update: (muted: boolean, volume: number) => void,
    volume: number
}

class VolumeControl extends React.Component<VolumeControlProps> {
    render() {
        return (
            <div className={"volume-control d-flex"}>
                <ControlButtonOverlay
                    id={"playerControl-volume"}
                    onClick={() => {
                        if (!this.props.controlsHidden) {
                            if (this.props.volume === 0) {
                                this.props.update(false, 0.3);
                            } else {
                                this.props.update(!this.props.muted, this.props.volume);
                            }
                        }
                    }}
                    tooltip={this.props.muted || this.props.volume === 0 ? "Unmute" : "Mute"}>
                    {this.props.muted || this.props.volume === 0 ? <FaVolumeMute/> :
                        (this.props.volume > 0.6 ? <FaVolumeUp/> : <FaVolumeDown/>)}
                </ControlButtonOverlay>
                <div className={"d-none d-sm-block volume-slider"}>
                    <Form.Control
                        type={"range"}
                        min={0}
                        max={1}
                        step={0.001}
                        onChange={(e) => {
                            const t = parseFloat(e.target.value);
                            if (this.props.muted && t > 0) {
                                this.props.update(false, t);
                                this.setState({
                                    muted: false,
                                    volume: t
                                });
                            } else {
                                this.props.update(this.props.muted, t);
                            }
                            e.target.style.setProperty("--value", (t * 100) + "%");
                        }}
                        style={{"--value": ((this.props.muted ? 0 : this.props.volume) * 100) + "%"} as React.CSSProperties}
                        aria-label={"Progress of playback"}
                        value={this.props.muted ? 0 : this.props.volume}/>
                </div>
            </div>
        );
    }
}

export default VolumeControl;
