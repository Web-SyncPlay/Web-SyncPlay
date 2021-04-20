import React from "react";
import {Button, Form, FormControl, InputGroup, Modal, OverlayTrigger, Popover} from "react-bootstrap";
import "./Modal.css";

interface InviteModalProps {
    roomId: string,
    show: boolean,
    closeModal: () => void
}

class InviteModal extends React.Component<InviteModalProps> {
    inviteLinkRef: HTMLInputElement | null;

    constructor(props: InviteModalProps) {
        super(props);

        this.inviteLinkRef = null;
    }

    copyToClipboard() {
        this.inviteLinkRef?.select();
        document.execCommand("copy");
    }

    render() {
        return (
            <Modal show={this.props.show} onHide={this.props.closeModal}>
                <Modal.Header closeButton>
                    <Modal.Title>
                        Invite your friends
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form.Group className={"mb-1"}>
                        <Form.Label>
                            Share this link to let more people join this room
                        </Form.Label>
                        <InputGroup>
                            <FormControl type={"text"}
                                         readOnly
                                         ref={(input: HTMLInputElement) => this.inviteLinkRef = input}
                                         placeholder={"Room ID"}
                                         value={window.location.href}
                                         aria-describedby={"inviteRoomAppend"}/>
                            <InputGroup.Append>

                                <OverlayTrigger
                                    trigger="click"
                                    placement="top"
                                    overlay={
                                        <Popover id={`inviteModal-successMsg-popover`}>
                                            <Popover.Content className={"text-success"}>
                                                Copied!
                                            </Popover.Content>
                                        </Popover>
                                    }>
                                    <Button type={"button"}
                                            id={"inviteRoomAppend"}
                                            onClick={this.copyToClipboard.bind(this)}
                                            variant={"primary"}>
                                        Copy
                                    </Button>
                                </OverlayTrigger>
                            </InputGroup.Append>
                        </InputGroup>
                    </Form.Group>
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

export default InviteModal;
