import React from "react";
import {Col} from "react-bootstrap";
import {BsMusicNoteBeamed, IoMdCopy, IoPlay, MdNavigateBefore, MdNavigateNext, RiDeleteBinLine} from "react-icons/all";
import ControlButtonOverlay from "../player/ControlButtonOverlay";

export interface QualityURL {
    quality: string,
    url: string
}

export interface CaptionURL {
    caption: string,
    url: string
}

export interface PlayURL {
    caption?: string | CaptionURL[],
    quality: string | QualityURL[]
}

export const getUrl = (url: string | PlayURL) => {
    if (typeof url === "string") {
        return url;
    } else if (typeof url.quality === "string") {
        return url.quality;
    }
    return url.quality[0].url;
}

interface QueueItemProps {
    index: number,
    queueIndex: number,
    queue: string[] | PlayURL[],
    playFromQueue: (index: number) => void,
    deleteFromQueue: (index: number) => void,
    swapQueueItems: (oldIndex: number, newIndex: number) => void
}

class QueueItemView extends React.Component<QueueItemProps> {
    urlInputRef: HTMLInputElement | null;

    constructor(props: QueueItemProps) {
        super(props);

        this.urlInputRef = null;
    }

    cssSafe(url: string | PlayURL) {
        return getUrl(url).replace(/[^a-z0-9]/g, (s) => {
            const c = s.charCodeAt(0);
            if (c === 32) {
                return "-";
            } else if (c >= 65 && c <= 90) {
                return "_" + s.toLowerCase();
            }
            return "__" + ("000" + c.toString(16)).slice(-4);
        });
    }

    copyToClipboard() {
        const tempInput = document.createElement("input");
        tempInput.value = getUrl(this.props.queue[this.props.index]);
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
    }

    render() {
        const css = this.cssSafe(this.props.queue[this.props.index]);
        const playing = this.props.queueIndex === this.props.index;
        return (
            <Col className={"col queue-item p-1"}>
                <div className={"rounded shadow p-1" + (playing ? " bg-dark" : "")}>
                    <div className={"d-flex w-100"}>
                        <div>
                            {this.props.index > 0 ?
                                <ControlButtonOverlay
                                    id={"tooltip-queue-" + css + "-before"}
                                    onClick={() => {
                                        this.props.swapQueueItems(this.props.index, this.props.index - 1);
                                    }}
                                    tooltip={"Move up"}>
                                    <MdNavigateBefore/>
                                </ControlButtonOverlay> :
                                <></>
                            }
                            {this.props.index < this.props.queue.length - 1 ?
                                <ControlButtonOverlay
                                    id={"tooltip-queue-" + css + "-after"}
                                    onClick={() => {
                                        this.props.swapQueueItems(this.props.index, this.props.index + 1);
                                    }}
                                    tooltip={"Move down"}>
                                    <MdNavigateNext/>
                                </ControlButtonOverlay> :
                                <></>
                            }
                        </div>
                        <div className={"ml-auto"}>
                            <ControlButtonOverlay
                                className={"text-secondary"}
                                id={"tooltip-queue-" + css + "-copy"}
                                onClick={this.copyToClipboard.bind(this)}
                                tooltip={"Copy source to clipboard"}>
                                <IoMdCopy/>
                            </ControlButtonOverlay>
                            {playing ?
                                <ControlButtonOverlay
                                    id={"tooltip-queue-" + css + "-playing"}
                                    tooltip={"Currently playing"}>
                                    <BsMusicNoteBeamed className={"text-warning blink"}/>
                                </ControlButtonOverlay> :
                                <>
                                    <ControlButtonOverlay
                                        className={"text-success"}
                                        id={"tooltip-queue-" + css + "-playFromQueue"}
                                        onClick={() => {
                                            this.props.playFromQueue(this.props.index);
                                        }}
                                        tooltip={"Play"}>
                                        <IoPlay/>
                                    </ControlButtonOverlay>
                                    <ControlButtonOverlay
                                        className={"text-danger"}
                                        id={"tooltip-queue-" + css + "-delete"}
                                        onClick={() => {
                                            this.props.deleteFromQueue(this.props.index);
                                        }}
                                        tooltip={"Delete item"}>
                                        <RiDeleteBinLine/>
                                    </ControlButtonOverlay>
                                </>
                            }
                        </div>
                    </div>
                    <a href={getUrl(this.props.queue[this.props.index])} target={"_blank"} rel={"noreferrer"}>
                        {this.props.queue[this.props.index]}
                    </a>
                </div>
            </Col>
        );
    }
}

export default QueueItemView;
