import React from "react";
import "./ControlButton.css";
import InteractionHandler from "./InteractionHandler";

interface ControlButtonProps {
    children: JSX.Element | JSX.Element[] | string,
    className?: string,
    onClick?: (e: React.TouchEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>, touch: boolean) => void
}

class ControlButton extends React.Component<ControlButtonProps> {
    render() {
        return (
            <InteractionHandler
                className={"control-button mx-1 " + (this.props.className || "")}
                onClick={(e, touch) => {
                    console.log("InteractionHandler");
                    if (this.props.onClick) {
                        this.props.onClick(e, touch);
                    }
                }}>
                {this.props.children}
            </InteractionHandler>
        );
    }
}

export default ControlButton;
