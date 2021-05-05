import React from "react";
import {OverlayTrigger, Tooltip} from "react-bootstrap";
import ControlButton from "./ControlButton";

interface ControlButtonOverlayProps {
    children: JSX.Element | JSX.Element[] | string,
    className?: string,
    id: string,
    onClick?: () => void,
    tooltip: JSX.Element | JSX.Element[] | string
}

class ControlButtonOverlay extends React.Component<ControlButtonOverlayProps> {
    render() {
        return (
            <OverlayTrigger
                placement={"top"}
                overlay={
                    <Tooltip id={this.props.id}>
                        {this.props.tooltip}
                    </Tooltip>
                }>
                <div style={{display: "inline-flex"}}>
                    <ControlButton className={this.props.className} onClick={this.props.onClick}>
                        {this.props.children}
                    </ControlButton>
                </div>
            </OverlayTrigger>
        );
    }
}

export default ControlButtonOverlay;
