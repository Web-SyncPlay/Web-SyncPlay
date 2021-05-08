import React from "react";
import {Button, Modal} from "react-bootstrap";
import InputURL from "../InputURL";


interface AddItemModalProps {
    show: boolean,
    closeModal: () => void,
    add: (urL: string) => void
}

class AddItemModel extends React.Component<AddItemModalProps> {
    urlInputRef: HTMLInputElement | null;

    constructor(props: AddItemModalProps) {
        super(props);
        this.urlInputRef = null;
    }

    componentDidUpdate(prevProps: Readonly<AddItemModalProps>) {
        if (prevProps.show !== this.props.show) {
            if (this.props.show) {
                setTimeout(() => {
                    if (this.urlInputRef) {
                        this.urlInputRef.focus();
                        this.urlInputRef.select();
                    }
                }, 200);
            }
        }
    }

    render() {
        return (
            <Modal show={this.props.show} onHide={this.props.closeModal}>
                <Modal.Header closeButton>
                    <Modal.Title>
                        Add item to queue
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <InputURL
                        className={""}
                        label={"Enter a link to the resource you want to append to the queue."}
                        getRef={(ref) => {
                            this.urlInputRef = ref
                        }}
                        submit={(url) => {
                            this.props.add(url);
                        }}>
                        Add
                    </InputURL>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={this.props.closeModal}>
                        Close
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

export default AddItemModel;
