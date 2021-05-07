import React from "react";

export const LEFT_MOUSE_CLICK = 0;

interface InteractionHandlerProps {
    children?: JSX.Element | JSX.Element[] | string,
    className?: string,
    noPrevent?: boolean,
    onClick?: (e: React.TouchEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>, touch: boolean) => void,
    onMove?: (e: React.TouchEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>, touch: boolean) => void,
}

class InteractionHandler extends React.Component<InteractionHandlerProps> {
    touched: boolean;
    touchedTime: number;

    constructor(props: InteractionHandlerProps) {
        super(props);
        this.touched = false;
        this.touchedTime = 0;
    }

    touch() {
        this.touchedTime = new Date().getTime();
        this.touched = true;

        setTimeout(() => {
            if (new Date().getTime() - this.touchedTime > 150) {
                this.touched = false;
            }
        }, 200);
    }

    render() {
        return (
            <div
                className={this.props.className}
                onTouchStart={(e) => {
                    this.touch();
                    if (this.props.onClick) {
                        if (!this.props.noPrevent) {
                            console.log("Prevent default touch start");
                            e.preventDefault();
                        }
                    }
                }}
                onTouchEnd={(e) => {
                    this.touch();
                    if (this.props.onClick) {
                        if (!this.props.noPrevent) {
                            console.log("Prevent default touch end");
                            e.preventDefault();
                        }
                        this.props.onClick(e, true);
                    }
                }}
                onTouchMove={(e) => {
                    if (this.props.onMove) {
                        this.props.onMove(e, true);
                    }
                }}
                onMouseDown={(e) => {
                    // ignored
                }}
                onMouseUp={(e) => {
                    if (e.button !== LEFT_MOUSE_CLICK || this.touched) {
                        return;
                    }
                    if (this.props.onClick) {
                        console.log("Mouse up, but touched:", this.touched);
                        this.props.onClick(e, false);
                    }
                }}
                onMouseMove={(e) => {
                    if (this.props.onMove) {
                        this.props.onMove(e, false);
                    }
                }}>
                {this.props.children}
            </div>
        );
    }
}

export default InteractionHandler;
