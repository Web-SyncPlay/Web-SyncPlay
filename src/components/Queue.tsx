import React from "react";
import "./Queue.css";
import {Col, OverlayTrigger, Row, Tooltip} from "react-bootstrap";
import {
    BiAddToQueue,
    BsMusicNoteBeamed,
    IoPlay,
    MdNavigateBefore,
    MdNavigateNext,
    RiDeleteBinLine
} from "react-icons/all";
import AddItemModal from "./AddItemModal";

interface QueueProps {
    queueIndex: number,
    queue: string[],
    play: (url: string) => void,
    playFromQueue: (index: number) => void,
    deleteFromQueue: (index: number) => void,
    swapQueueItems: (oldIndex: number, newIndex: number) => void,
    addToQueue: (url: string) => void
}

interface QueueState {
    showAddItemModel: boolean
}

class Queue extends React.Component<QueueProps, QueueState> {
    constructor(props: QueueProps) {
        super(props);

        this.state = {
            showAddItemModel: false
        };
    }

    cssSafe(url: string) {
        return url.replace(/[^a-z0-9]/g, (s) => {
            let c = s.charCodeAt(0);
            if (c === 32) {
                return "-";
            } else if (c >= 65 && c <= 90) {
                return "_" + s.toLowerCase();
            }
            return "__" + ("000" + c.toString(16)).slice(-4);
        });
    }

    closeAddItemModal() {
        this.setState({
            showAddItemModel: false
        });
    }

    renderItem(q: string, index: number) {
        const css = this.cssSafe(q);
        const playing = this.props.queueIndex === index;
        return (
            <Col key={index + q}
                 className={"queue-item rounded shadow my-2 mx-1 p-1" + (playing ? " bg-dark" : "")}>
                <div className={"d-flex w-100"}>
                    <div>
                        {index > 0 ?
                            <OverlayTrigger
                                placement={"top"}
                                overlay={
                                    <Tooltip id={"tooltip-queue-" + css + "-before"}>
                                        Move up
                                    </Tooltip>
                                }>
                                <div className={"canPlay-message d-inline-flex"}>
                                    <div className={"control-button rounded p-1 mr-1"}
                                         onClick={() => {
                                             this.props.swapQueueItems(index, index - 1);
                                         }}>
                                        <MdNavigateBefore/>
                                    </div>
                                </div>
                            </OverlayTrigger> :
                            <></>
                        }
                        {playing ?
                            <OverlayTrigger
                                placement={"top"}
                                overlay={
                                    <Tooltip id={"tooltip-queue-" + css + "-playing"}>
                                        Currently playing
                                    </Tooltip>
                                }>
                                <div className={"canPlay-message d-inline-flex"}>
                                    <div className={"control-button rounded p-1 mr-1"}>
                                        <BsMusicNoteBeamed className={"blink"}/>
                                    </div>
                                </div>
                            </OverlayTrigger> :
                            <></>
                        }
                        {index < this.props.queue.length - 1 ?
                            <OverlayTrigger
                                placement={"top"}
                                overlay={
                                    <Tooltip id={"tooltip-queue-" + css + "-after"}>
                                        Move down
                                    </Tooltip>
                                }>
                                <div className={"canPlay-message d-inline-flex"}>
                                    <div className={"control-button rounded p-1 mr-1"}
                                         onClick={() => {
                                             this.props.swapQueueItems(index, index + 1);
                                         }}>
                                        <MdNavigateNext/>
                                    </div>
                                </div>
                            </OverlayTrigger> :
                            <></>
                        }
                    </div>
                    <div className={"ml-auto"}>
                        <OverlayTrigger
                            placement={"top"}
                            overlay={
                                <Tooltip id={"tooltip-queue-" + css + "-playFromQueue"}>
                                    Play
                                </Tooltip>
                            }>
                            <div className={"canPlay-message d-inline-flex"}>
                                <div className={"control-button rounded p-1 mr-1"}
                                     onClick={() => {
                                         this.props.playFromQueue(index);
                                     }}>
                                    <IoPlay/>
                                </div>
                            </div>
                        </OverlayTrigger>
                        <OverlayTrigger
                            placement={"top"}
                            overlay={
                                <Tooltip id={"tooltip-queue-" + css + "-delete"}>
                                    Delete from queue
                                </Tooltip>
                            }>
                            <div className={"canPlay-message d-inline-flex"}>
                                <div className={"control-button rounded p-1 mr-1 text-danger"}
                                     onClick={() => {
                                         this.props.deleteFromQueue(index);
                                     }}>
                                    <RiDeleteBinLine/>
                                </div>
                            </div>
                        </OverlayTrigger>
                    </div>
                </div>
                <a href={q} target={"_blank"}>
                    {q}
                </a>
            </Col>
        );
    }

    render() {
        return (
            <>
                <Row className={"queue rounded shadow mx-4 px-1"}>
                    {this.props.queue.map((q, index) => this.renderItem(q, index))}
                    <div className={"queue-item rounded shadow my-2 mx-1 p-3 add-notice text-muted"}
                         onClick={() => {
                             this.setState({
                                 showAddItemModel: true
                             });
                         }}>
                        <span>Add item</span>
                        <BiAddToQueue/>
                    </div>
                </Row>
                <AddItemModal show={this.state.showAddItemModel}
                              closeModal={this.closeAddItemModal.bind(this)}
                              add={this.props.addToQueue}/>
            </>
        );
    }
}

export default Queue;
