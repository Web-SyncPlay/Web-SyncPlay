import React from "react";
import "./ControlButton.css";

export const LEFT_MOUSE_CLICK = 0;

interface ControlButtonProps {
    children: JSX.Element | JSX.Element[] | string,
    className?: string,
    onClick?: () => void
}

class ControlButton extends React.Component<ControlButtonProps> {
    render() {
        return (
            <div className={"control-button mx-1 " + (this.props.className || "")}
                 onTouchEnd={(e) => {
                     e.preventDefault();
                     if (this.props.onClick) {
                         this.props.onClick();
                     }
                 }}
                 onMouseUp={(e) => {
                     if (e.button !== LEFT_MOUSE_CLICK) {
                         return;
                     }
                     if (this.props.onClick) {
                         this.props.onClick();
                     }
                 }}>
                {this.props.children}
            </div>
        );
    }
}

export default ControlButton;
