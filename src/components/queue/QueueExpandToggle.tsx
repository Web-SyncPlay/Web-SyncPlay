import React, {useContext} from "react";
import {AccordionContext, OverlayTrigger, Tooltip, useAccordionToggle} from "react-bootstrap";
import {MdExpandLess, MdExpandMore} from "react-icons/all";
import {LEFT_MOUSE_CLICK} from "../player/ControlButton";
import "../player/ControlButton.css";


interface QueueExpandToggleProps {
    eventKey: string
}

const QueueExpandToggle = (props: QueueExpandToggleProps) => {
    const currentEventKey = useContext(AccordionContext);
    const decoratedOnClick = useAccordionToggle(props.eventKey);
    const isCurrentEventKey = currentEventKey === props.eventKey;

    return (
        <OverlayTrigger
            placement={"top"}
            overlay={
                <Tooltip id={"tooltip-queue-expand"}>
                    {isCurrentEventKey ? "Hide queue" : "Show queue"}
                </Tooltip>
            }>
            <div style={{display: "inline-flex"}}>
                <div className={"control-button ml-1"}
                     onTouchEnd={(e) => {
                         e.preventDefault();
                         decoratedOnClick(e);
                     }}
                     onMouseUp={(e) => {
                         if (e.button !== LEFT_MOUSE_CLICK) {
                             return;
                         }
                         decoratedOnClick(e);
                     }}>
                    {isCurrentEventKey ?
                        <MdExpandLess/> :
                        <MdExpandMore/>
                    }
                </div>
            </div>
        </OverlayTrigger>
    );
};

export default QueueExpandToggle;
