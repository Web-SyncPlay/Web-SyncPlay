import React, {useContext} from "react";
import {AccordionContext, OverlayTrigger, Tooltip, useAccordionToggle} from "react-bootstrap";
import {MdExpandLess, MdExpandMore} from "react-icons/all";


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
            <div className={"control-button"}
                 onClick={decoratedOnClick}>
                {isCurrentEventKey ?
                    <MdExpandLess/> :
                    <MdExpandMore/>
                }
            </div>
        </OverlayTrigger>
    );
};

export default QueueExpandToggle;
