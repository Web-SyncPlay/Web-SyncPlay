import React from "react";
import {Button, Modal} from "react-bootstrap";
import {AiOutlineWarning} from "react-icons/all";

interface ConfirmClearModalProps {
    show: boolean,
    onHide: () => void,
    queueLength: number,
    clear: () => void
}

class ConfirmClearModal extends React.Component<ConfirmClearModalProps> {
    render() {
        return (
            <Modal show={this.props.show} onHide={this.props.onHide}>
                <Modal.Header closeButton>
                    <Modal.Title>
                        <AiOutlineWarning className={"text-warning"}
                                          style={{
                                              marginTop: "-0.25em"
                                          }}/> Clear queue
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    Are you really sure you want to clear the queue
                    of <kbd>{this.props.queueLength}</kbd> items?
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="outline-danger" onClick={() => {
                        this.props.clear();
                        this.props.onHide();
                    }}>
                        Clear
                    </Button>
                    <Button variant="success" onClick={this.props.onHide}>
                        Nevermind
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

export default ConfirmClearModal;
