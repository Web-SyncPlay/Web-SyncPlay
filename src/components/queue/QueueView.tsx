import React from "react";
import "./Queue.css";
import {BiAddToQueue, GiTvRemote, ImEmbed2, RiDeleteBinLine} from "react-icons/all";
import AddItemModal from "../modal/AddItemModal";
import QueueItemView, {getUrl, PlayURL} from "./QueueItemView";
import {Accordion, Row} from "react-bootstrap";
import ConfirmClearModal from "../modal/ConfirmClearModal";
import QueueExpandToggle from "./QueueExpandToggle";
import CreateEmbedModal from "../modal/CreateEmbedModal";
import ControlButtonOverlay from "../player/ControlButtonOverlay";

interface QueueProps {
    isEmbed: boolean,
    queue: string[] | PlayURL[],
    queueIndex: number,
    roomId: string,
    updateState: (data: any) => void,
    url: string | PlayURL
}

interface QueueState {
    showAddItemModal: boolean,
    showConfirmClearModal: boolean,
    showCreateEmbedModal: boolean
}

class QueueView extends React.Component<QueueProps, QueueState> {
    constructor(props: QueueProps) {
        super(props);

        this.state = {
            showAddItemModal: false,
            showConfirmClearModal: false,
            showCreateEmbedModal: false
        };
    }

    closeAddItemModal() {
        this.setState({
            showAddItemModal: false
        });
    }

    addToQueue(url: string) {
        this.props.updateState({
            interaction: true,
            queue: [...this.props.queue, url]
        });
    }

    playFromQueue(index: number) {
        this.props.updateState({
            interaction: true,
            played: 0,
            playing: true,
            queueIndex: index,
            url: this.props.queue[index]
        });
    }

    swapQueueItems(oldIndex: number, newIndex: number) {
        const queue = [...this.props.queue];
        const old = queue[oldIndex];
        queue[oldIndex] = queue[newIndex];
        queue[newIndex] = old;

        if ([oldIndex, newIndex].includes(this.props.queueIndex)) {
            this.props.updateState({
                interaction: true,
                queue,
                queueIndex: this.props.queueIndex === newIndex ? oldIndex : newIndex
            });
        } else {
            this.props.updateState({
                interaction: true,
                queue
            });
        }
    }

    deleteFromQueue(index: number) {
        if (this.props.queueIndex >= index) {
            this.props.updateState({
                interaction: true,
                queue: [...this.props.queue].filter((e, i) => i !== index),
                queueIndex: this.props.queueIndex - 1
            });
        } else {
            this.props.updateState({
                interaction: true,
                queue: [...this.props.queue].filter((e, i) => i !== index)
            });
        }
    }

    clearQueue() {
        this.props.updateState({
            interaction: true,
            queue: [],
            queueIndex: -1
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
                        {this.props.isEmbed ? <></> :
                            <>
                                <ControlButtonOverlay
                                    className={"text-secondary"}
                                    id={"tooltip-queue-expand"}
                                    onClick={() => {
                                        window.open("/embed/controller/" + this.props.roomId,
                                            "Room " + this.props.roomId + " Controller",
                                            "width=350,height=600," +
                                            "toolbar=false,location=false," +
                                            "status=false,menubar=false," +
                                            "dependent=true,resizable=true");
                                    }}
                                    tooltip={"Open controller"}>
                                    <GiTvRemote/>
                                </ControlButtonOverlay>
                                <ControlButtonOverlay
                                    className={"text-warning"}
                                    id={"tooltip-queue-expand"}
                                    onClick={() => {
                                        this.setState({
                                            showCreateEmbedModal: true
                                        });
                                    }}
                                    tooltip={"Create embed"}>
                                    <ImEmbed2/>
                                </ControlButtonOverlay>
                            </>
                        }
                        <ControlButtonOverlay
                            className={"text-danger"}
                            id={"tooltip-queue-clear"}
                            onClick={() => {
                                this.setState({
                                    showConfirmClearModal: true
                                });
                            }}
                            tooltip={"Clear queue"}>
                            <RiDeleteBinLine/>
                        </ControlButtonOverlay>
                        <QueueExpandToggle eventKey={"queue-expand"}/>
                    </div>
                </div>
                <ConfirmClearModal
                    clear={this.clearQueue.bind(this)}
                    onHide={() => {
                        this.setState({
                            showConfirmClearModal: false
                        });
                    }}
                    queueLength={this.props.queue.length}
                    show={this.state.showConfirmClearModal}/>
                <CreateEmbedModal
                    roomId={this.props.roomId}
                    onHide={() => {
                        this.setState({
                            showCreateEmbedModal: false
                        });
                    }}
                    queue={this.props.queue}
                    queueIndex={this.props.queueIndex}
                    show={this.state.showCreateEmbedModal}
                    url={this.props.url}
                />
                <Accordion.Collapse eventKey={"queue-expand"}>
                    <Row className={"queue-items-list p-1"}
                         id={"queue-collapse"}>
                        {this.props.queue.map((q: string | PlayURL, index: number) =>
                            <QueueItemView
                                key={getUrl(q) + index}
                                index={index}
                                queueIndex={this.props.queueIndex}
                                queue={this.props.queue}
                                playFromQueue={this.playFromQueue.bind(this)}
                                deleteFromQueue={this.deleteFromQueue.bind(this)}
                                swapQueueItems={this.swapQueueItems.bind(this)}
                            />)}
                        <div className={"col queue-item p-1 add-notice"}>
                            <div className={"rounded shadow p-3 text-muted"}
                                 onClick={() => {
                                     this.setState({
                                         showAddItemModal: true
                                     });
                                 }}>
                                <span>Add item</span>
                                <BiAddToQueue/>
                            </div>
                        </div>
                    </Row>
                </Accordion.Collapse>
                <AddItemModal
                    show={this.state.showAddItemModal}
                    closeModal={this.closeAddItemModal.bind(this)}
                    add={this.addToQueue.bind(this)}/>
            </Accordion>
        );
    }

}

export default QueueView;
