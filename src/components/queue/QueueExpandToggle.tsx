import React, {useContext} from "react";
import {AccordionContext, OverlayTrigger, Tooltip, useAccordionToggle} from "react-bootstrap";
import {MdExpandLess, MdExpandMore} from "react-icons/all";
import InteractionHandler from "../player/InteractionHandler";
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
                <InteractionHandler
                    className={"control-button ml-1"}
                    onClick={(e, touch) => {
                        decoratedOnClick(e);
                    }}>
                    {isCurrentEventKey ?
                        <MdExpandLess/> :
                        <MdExpandMore/>
                    }
                </InteractionHandler>
            </div>
        </OverlayTrigger>
    );
};

export default QueueExpandToggle;
