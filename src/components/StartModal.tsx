import React from "react";
import {
    Button,
    Col,
    Form,
    FormControl,
    FormGroup,
    FormLabel,
    InputGroup,
    ModalBody,
    ModalDialog,
    ModalFooter,
    Row
} from "react-bootstrap";
import "./Modal.css";
import ModalHeader from "react-bootstrap/ModalHeader";

interface StartModalProps {
    generateRoom: () => void,
    joinRoom: (id: string) => void
}

interface StartModalState {
    roomId: string
}

class StartModal extends React.Component<StartModalProps> {
    state: StartModalState;

    constructor(props: StartModalProps) {
        super(props);

        this.state = {
            roomId: ""
        };
    }

    updateRoomId(roomId: string) {
        this.setState({roomId: roomId});
    }

    render() {
        return (
            <ModalDialog>
                <ModalHeader>
                    <h4 className={"mb-0"}>
                        Studi-Watch
                    </h4>
                </ModalHeader>
                <ModalBody>
                    <Form onSubmit={(e) => {
                        e.preventDefault();
                        this.props.joinRoom(this.state.roomId);
                    }}>
                        <FormGroup as={Row}>
                            <FormLabel column xs={"2"}>
                                Join
                            </FormLabel>
                            <Col xs={"10"}>
                                <InputGroup>
                                    <FormControl type={"text"}
                                                 placeholder={"Room ID"}
                                                 value={this.state.roomId}
                                                 onChange={(e) => this.updateRoomId(e.target.value)}
                                                 required
                                                 aria-describedby={"joinRoomAppend"}/>
                                    <InputGroup.Append>
                                        <Button type={"submit"} id={"joinRoomAppend"} variant={"primary"}>
                                            Go
                                        </Button>
                                    </InputGroup.Append>
                                </InputGroup>
                            </Col>
                        </FormGroup>
                    </Form>
                    <FormGroup as={Row} className={"mb-0"}>
                        <FormLabel column xs={"2"}>
                            Or
                        </FormLabel>
                        <Col xs={"10"}>
                            <Button variant={"outline-success"} block onClick={this.props.generateRoom}>
                                Create a new room
                            </Button>
                        </Col>
                    </FormGroup>
                </ModalBody>
                <ModalFooter>
                    Let's watch together
                </ModalFooter>
            </ModalDialog>
        );
    }
}

export default StartModal;
