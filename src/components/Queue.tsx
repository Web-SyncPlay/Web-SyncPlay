import React from "react";
import "./Queue.css";
import {BiAddToQueue, RiDeleteBinLine} from "react-icons/all";
import AddItemModal from "./AddItemModal";
import QueueItem from "./QueueItem";
import {Accordion, OverlayTrigger, Row, Tooltip} from "react-bootstrap";
import ConfirmClearModal from "./ConfirmClearModal";
import QueueExpandToggle from "./QueueExpandToggle";

interface QueueProps {
    queueIndex: number,
    queue: string[],
    play: (url: string) => void,
    playFromQueue: (index: number) => void,
    deleteFromQueue: (index: number) => void,
    swapQueueItems: (oldIndex: number, newIndex: number) => void,
    clearQueue: () => void,
    addToQueue: (url: string) => void
}

interface QueueState {
    showAddItemModal: boolean,
    showConfirmClearModal: boolean
}

class Queue extends React.Component<QueueProps, QueueState> {
    constructor(props: QueueProps) {
        super(props);

        this.state = {
            showAddItemModal: false,
            showConfirmClearModal: false
        };
    }

    closeAddItemModal() {
        this.setState({
            showAddItemModal: false
        });
    }

    render() {
        return (
            <Accordion className={"queue rounded shadow"}
                       defaultActiveKey={"queue-expand"}>
                <div className={"queue-header rounded p-1"}>
                    <div className="ml-1 d-flex align-items-center">
                        <h5 className={"mb-0"}>
                            Playback queue
                        </h5>
                    </div>
                    <div className={"ml-auto"}>
                        <OverlayTrigger
                            placement={"top"}
                            overlay={
                                <Tooltip id={"tooltip-queue-expand"}>
                                    Clear queue
                                </Tooltip>
                            }>
                            <div className={"control-button text-danger mx-1"}
                                 onClick={() => {
                                     this.setState({
                                         showConfirmClearModal: true
                                     });
                                 }}>
                                <RiDeleteBinLine/>
                            </div>
                        </OverlayTrigger>
                        <QueueExpandToggle eventKey={"queue-expand"}/>
                    </div>
                </div>
                <ConfirmClearModal show={this.state.showConfirmClearModal}
                                   onHide={() => {
                                       this.setState({
                                           showConfirmClearModal: false
                                       });
                                   }}
                                   queueLength={this.props.queue.length}
                                   clear={this.props.clearQueue}/>
                <Accordion.Collapse eventKey={"queue-expand"}>
                    <Row className={"m-0"}
                         id={"queue-collapse"}>
                        {this.props.queue.map((q, index) =>
                            <QueueItem
                                key={q + index}
                                index={index}
                                queueIndex={this.props.queueIndex}
                                queue={this.props.queue}
                                play={this.props.play}
                                playFromQueue={this.props.playFromQueue}
                                deleteFromQueue={this.props.deleteFromQueue}
                                swapQueueItems={this.props.swapQueueItems}
                            />)}
                        <div className={"queue-item rounded shadow my-2 mx-1 p-3 add-notice text-muted"}
                             onClick={() => {
                                 this.setState({
                                     showAddItemModal: true
                                 });
                             }}>
                            <span>Add item</span>
                            <BiAddToQueue/>
                        </div>
                    </Row>
                </Accordion.Collapse>
                <AddItemModal show={this.state.showAddItemModal}
                              closeModal={this.closeAddItemModal.bind(this)}
                              add={this.props.addToQueue}/>
            </Accordion>
        );
    }

}

export default Queue;
