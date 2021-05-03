import React from "react";
import {Button, Form, FormControl, InputGroup, Modal} from "react-bootstrap";
import ReactPlayer from "react-player";


interface AddItemModalProps {
    show: boolean,
    closeModal: () => void,
    add: (urL: string) => void
}

interface AddItemModalState {
    url: string,
    valid: boolean,
    validated: boolean
}

class AddItemModel extends React.Component<AddItemModalProps, AddItemModalState> {
    urlInputRef: HTMLInputElement | null;

    constructor(props: AddItemModalProps) {
        super(props);
        this.urlInputRef = null;

        this.state = {
            url: "",
            valid: false,
            validated: false
        };
    }

    componentDidUpdate(prevProps: Readonly<AddItemModalProps>, prevState: Readonly<AddItemModalState>) {
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
                    <Form noValidate className={"mb-1"}
                          onSubmit={(e) => {
                              e.preventDefault();
                              if (this.state.url !== "" && this.state.valid) {
                                  this.props.add(this.state.url);
                                  this.setState({
                                      url: "",
                                      valid: false,
                                      validated: false
                                  });
                              }
                          }}>
                        <Form.Group>
                            <Form.Label>
                                Enter a link to the resource you want to append to the queue.
                            </Form.Label>
                            <InputGroup hasValidation={this.state.validated}>
                                <FormControl type={"text"}
                                             value={this.state.url}
                                             placeholder={"URL to media"}
                                             required
                                             ref={(input: HTMLInputElement) => this.urlInputRef = input}
                                             onChange={(e) => {
                                                 if (e.target.value === "") {
                                                     this.setState({
                                                         url: "",
                                                         valid: false,
                                                         validated: false
                                                     });
                                                 } else {
                                                     this.setState({
                                                         url: e.target.value,
                                                         valid: ReactPlayer.canPlay(e.target.value),
                                                         validated: true
                                                     });
                                                 }
                                             }}
                                             isValid={this.state.valid && this.state.validated}
                                             isInvalid={!this.state.valid && this.state.validated}
                                             aria-describedby={"addItemQueue-modal-append"}/>
                                <InputGroup.Append>
                                    <Button type={"submit"}
                                            id={"addItemQueue-modal-append"}
                                            style={{
                                                borderTopRightRadius: "0.25rem",
                                                borderBottomRightRadius: "0.25rem"
                                            }}
                                            variant={"outline-success"}>
                                        Add
                                    </Button>
                                </InputGroup.Append>
                                {this.state.valid ?
                                    <Form.Control.Feedback type={"valid"}>
                                        This seems playable
                                    </Form.Control.Feedback> :
                                    <Form.Control.Feedback type={"invalid"}>
                                        This doesn't seem to be a valid url or the provided media is unplayable
                                    </Form.Control.Feedback>
                                }
                            </InputGroup>
                        </Form.Group>
                    </Form>
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
