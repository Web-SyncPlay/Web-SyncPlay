import React from "react";
import "./Queue.css";
import {BiAddToQueue} from "react-icons/all";
import AddItemModal from "./AddItemModal";
import QueueItem from "./QueueItem";
import {Row} from "react-bootstrap";

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

    closeAddItemModal() {
        this.setState({
            showAddItemModel: false
        });
    }

    render() {
        return (
            <div>
                <Row className={"queue rounded shadow m-0"}>
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
            </div>
        );
    }

}

export default Queue;
