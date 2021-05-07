import React from "react";
import ControlButtonOverlay from "./ControlButtonOverlay";
import {FaVolumeDown, FaVolumeMute, FaVolumeUp} from "react-icons/all";
import "./VolumeControl.css";
import Slider from "./Slider";

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
                    onClick={(e, touch) => {
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
                <Slider
                    ariaLabel={"Volume"}
                    className={"d-none d-sm-block volume-slider"}
                    played={this.props.muted ? 0 : this.props.volume}
                    updateSeek={(t) => {
                        if (this.props.muted && t > 0) {
                            this.props.update(false, t);
                        } else {
                            this.props.update(this.props.muted, t);
                        }
                    }}/>
            </div>
        );
    }
}

export default VolumeControl;
