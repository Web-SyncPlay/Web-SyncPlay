import React from "react";
import {Col, OverlayTrigger, Tooltip} from "react-bootstrap";
import {BsMusicNoteBeamed, IoMdCopy, IoPlay, MdNavigateBefore, MdNavigateNext, RiDeleteBinLine} from "react-icons/all";

interface QueueItemProps {
    index: number,
    queueIndex: number,
    queue: string[],
    play: (url: string) => void,
    playFromQueue: (index: number) => void,
    deleteFromQueue: (index: number) => void,
    swapQueueItems: (oldIndex: number, newIndex: number) => void
}

class QueueItem extends React.Component<QueueItemProps> {
    urlInputRef: HTMLInputElement | null;

    constructor(props: QueueItemProps) {
        super(props);

        this.urlInputRef = null;
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

    copyToClipboard() {
        let tempInput = document.createElement("input");
        tempInput.value = this.props.queue[this.props.index];
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
    }

    render() {
        const css = this.cssSafe(this.props.queue[this.props.index]);
        const playing = this.props.queueIndex === this.props.index;
        return (
            <Col className={"queue-item rounded shadow my-2 mx-1 p-1" + (playing ? " bg-dark" : "")}>
                <div className={"d-flex w-100"}>
                    <div>
                        {this.props.index > 0 ?
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
                                             this.props.swapQueueItems(this.props.index, this.props.index - 1);
                                         }}>
                                        <MdNavigateBefore/>
                                    </div>
                                </div>
                            </OverlayTrigger> :
                            <></>
                        }
                        {this.props.index < this.props.queue.length - 1 ?
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
                                             this.props.swapQueueItems(this.props.index, this.props.index + 1);
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
                                <Tooltip id={"tooltip-queue-" + css + "-copy"}>
                                    Copy source to clipboard
                                </Tooltip>
                            }>
                            <div className={"canPlay-message d-inline-flex"}>
                                <div className={"control-button rounded p-1 mr-1"}
                                     onClick={this.copyToClipboard.bind(this)}>
                                    <IoMdCopy/>
                                </div>
                            </div>
                        </OverlayTrigger>
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
                            <>
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
                                                 this.props.playFromQueue(this.props.index);
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
                                                 this.props.deleteFromQueue(this.props.index);
                                             }}>
                                            <RiDeleteBinLine/>
                                        </div>
                                    </div>
                                </OverlayTrigger>
                            </>
                        }
                    </div>
                </div>
                <a href={this.props.queue[this.props.index]} target={"_blank"}>
                    {this.props.queue[this.props.index]}
                </a>
            </Col>
        );
    }
}

export default QueueItem;
