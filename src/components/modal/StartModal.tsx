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
import {Helmet} from "react-helmet";
import {IoEnter} from "react-icons/all";

const ENDPOINT = process.env.REACT_APP_DOCKER ? "" : "http://localhost:8081";

interface StartModelProps {
    join: (id: string) => void
}

interface StartModalState {
    roomId: string
}

class StartModal extends React.Component<StartModelProps, StartModalState> {
    constructor(props: StartModelProps) {
        super(props);

        this.state = {
            roomId: ""
        };
    }

    updateRoomId(roomId: string) {
        this.setState({roomId});
    }

    generateRoom() {
        return fetch(ENDPOINT + "/room/generate")
            .then((res) => res.json())
            .then((data) => this.props.join(data.id));
    }

    render() {
        return (
            <ModalDialog>
                <Helmet>
                    <title>Web-SyncPlay</title>
                    <link rel="canonical" href="/"/>
                </Helmet>
                <ModalHeader>
                    <h4 className={"mb-0"}
                        style={{
                            fontFamily: "Zen Dots"
                        }}>
                        Web-SyncPlay
                    </h4>
                </ModalHeader>
                <ModalBody>
                    <Form onSubmit={(e) => {
                        e.preventDefault();
                        this.props.join(this.state.roomId);
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
                                        <Button type={"submit"} id={"joinRoomAppend"} variant={"outline-success"}>
                                            <IoEnter style={{
                                                marginTop: "-0.2em"
                                            }}/>
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
                            <Button variant={"success"} block onClick={() => this.generateRoom()}>
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
