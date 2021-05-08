import React from "react";
import "./Queue.css";
import {BiAddToQueue, GiTvRemote, ImEmbed2, RiDeleteBinLine} from "react-icons/all";
import AddItemModal from "../modal/AddItemModal";
import QueueItem, {getUrl, PlayURL} from "./QueueItem";
import {Accordion, Row} from "react-bootstrap";
import ConfirmClearModal from "../modal/ConfirmClearModal";
import QueueExpandToggle from "./QueueExpandToggle";
import CreateEmbedModal from "../modal/CreateEmbedModal";
import ControlButtonOverlay from "../player/ControlButtonOverlay";

interface QueueProps {
    addToQueue: (url: string) => void,
    clearQueue: () => void,
    deleteFromQueue: (index: number) => void,
    play: (url: string | PlayURL) => void,
    playFromQueue: (index: number) => void,
    queue: string[] | PlayURL[],
    queueIndex: number,
    roomId: string,
    swapQueueItems: (oldIndex: number, newIndex: number) => void,
    url: string | PlayURL
}

interface QueueState {
    showAddItemModal: boolean,
    showConfirmClearModal: boolean,
    showCreateEmbedModal: boolean
}

class Queue extends React.Component<QueueProps, QueueState> {
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
                        <ControlButtonOverlay
                            className={"text-secondary"}
                            id={"tooltip-queue-expand"}
                            onClick={() => {
                                window.open("/embed/controller/" + this.props.roomId,
                                    "Room " + this.props.roomId + " Controller",
                                    "width=854,height=480," +
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
                    clear={this.props.clearQueue}
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
                    <Row className={"m-0"}
                         id={"queue-collapse"}>
                        {this.props.queue.map((q: string | PlayURL, index: number) =>
                            <QueueItem
                                key={getUrl(q) + index}
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
