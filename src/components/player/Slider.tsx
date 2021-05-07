import React from "react";
import "./Slider.css";
import {Form} from "react-bootstrap";

interface SliderProps {
    ariaLabel?: string,
    className?: string,
    played: number,
    updateSeek: (t: number) => void
}

interface SliderState {

}

class Slider extends React.Component<SliderProps, SliderState> {
    constructor(props: SliderProps) {
        super(props);

        this.state = {};
    }

    render() {
        return (
            <div className={"slider " + (this.props.className)}>
                <Form.Control
                    type={"range"}
                    min={0}
                    max={1}
                    step={0.001}
                    onChange={(e) => {
                        console.log("slider change", e);
                        const t = parseFloat(e.target.value);
                        e.target.style.setProperty("--value", (t * 100) + "%");
                        this.props.updateSeek(t);
                    }}
                    style={{"--value": (this.props.played * 100) + "%"} as React.CSSProperties}
                    aria-label={this.props.ariaLabel}
                    value={this.props.played}/>
            </div>
        );
    }
}

export default Slider;
