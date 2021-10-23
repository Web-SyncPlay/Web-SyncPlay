import React, {ChangeEvent} from "react";
import {Button, Col, Form, InputGroup, Modal, OverlayTrigger, Popover, Row} from "react-bootstrap";
import {ImEmbed2, IoMdCopy} from "react-icons/all";
import {getUrl, PlayURL} from "../queue/QueueItemView";
import {canPlay} from "../../utils";

interface CreateEmbedModalProps {
    roomId: string,
    onHide: () => void,
    show: boolean,
    queue: string[] | PlayURL[],
    queueIndex: number,
    url: string | PlayURL
}

interface CreateEmbedModalState {
    controlsOption: string,
    includeQueue: boolean,
    url: string,
    queue: number[],
    queueIndex: number,
    result: string,
    valid: boolean,
    validated: boolean
}

class CreateEmbedModal extends React.Component<CreateEmbedModalProps, CreateEmbedModalState> {
    resultRef: HTMLTextAreaElement | null;

    constructor(props: CreateEmbedModalProps) {
        super(props);
        this.resultRef = null;

        this.state = {
            controlsOption: "show",
            includeQueue: true,
            url: getUrl(this.props.url),
            queue: this.props.queue.map((q: string | PlayURL, i: number) => i),
            queueIndex: this.props.queueIndex,
            result: "",
            valid: false,
            validated: false
        };
    }

    componentDidMount() {
        this.setState({
            result: this.getEmbedCode(this.state)
        });
    }

    componentDidUpdate(prevProps: Readonly<CreateEmbedModalProps>) {
        if (prevProps.show !== this.props.show) {
            if (this.props.show) {
                this.updateState({
                    queue: this.props.queue.map((q: string | PlayURL, i: number) => i),
                    queueIndex: this.props.queueIndex.toString()
                });

                setTimeout(() => {
                    if (this.resultRef) {
                        this.resultRef.focus();
                        this.resultRef.select();
                    }
                }, 200);
            }
        }
    }

    updateState(data: any) {
        this.setState({
            ...data,
        });

        // small timeout to let the changed data propagate
        setTimeout(() => this.setState({
            result: this.getEmbedCode(this.state)
        }), 100);
    }

    copyToClipboard() {
        this.resultRef?.select();
        document.execCommand("copy");
    }

    getEmbedCode(state: CreateEmbedModalState) {
        let params = new URLSearchParams();

        if (state.includeQueue) {
            let currentIndex = 0;

            this.state.queue.forEach((i) => {
                if (i < this.state.queueIndex) {
                    currentIndex += 1;
                }
                params.append("queue", getUrl(this.props.queue[i]));
            });

            params.append("queueIndex", currentIndex.toString());
        } else {
            params.append("url", getUrl(this.state.url));
        }

        if (state.controlsOption !== "show") {
            params.append("controlsHidden", "false");
            if (state.controlsOption === "raw") {
                params.append("showRootPlayer", "true");
            }
        }

        return "<iframe allow=\"fullscreen; autoplay; encrypted-media; picture-in-picture\" " +
            "style=\"border:none;\" width=\"100%\" height=\"100%\" src=\"" +
            window.location.protocol + "//" +
            window.location.host + "/embed/player/" +
            this.props.roomId + "?" + params.toString() + "\"></iframe>";
    }

    render() {
        return (
            <Modal onHide={this.props.onHide}
                   show={this.props.show}
                   size={"lg"}>
                <Modal.Header closeButton>
                    <Modal.Title>
                        <ImEmbed2 className={"text-warning"}
                                  style={{
                                      marginTop: "-0.25em"
                                  }}/> Create an embed
                    </Modal.Title>
                </Modal.Header>

                <Modal.Body>
                    <Form.Group as={Row}>
                        <Form.Label column sm="2">
                            Controls
                        </Form.Label>
                        <Col sm="10">
                            <Form.Control
                                as={"select"}
                                onChange={(e) => {
                                    this.updateState({
                                        controlsOption: e.target.value
                                    });
                                }}
                                value={this.state.controlsOption}>
                                <option value={"show"}>Show player controls</option>
                                <option value={"hide"}>Hide player controls</option>
                                <option value={"raw"}>Access underlying player</option>
                            </Form.Control>
                        </Col>
                    </Form.Group>

                    <div className={"px-2"}>
                        <Form.Check
                            checked={this.state.includeQueue}
                            className={"ml-4"}
                            id={"create-embed-includeQueue"}
                            label={"Include queue"}
                            onChange={() => this.updateState({
                                includeQueue: !this.state.includeQueue
                            })}
                            type={"switch"}
                        />
                    </div>
                    {this.state.includeQueue ?
                        <>
                            <Form.Group as={Row}>
                                <Form.Label column sm="2">
                                    Queue items
                                </Form.Label>
                                <Col sm="10">
                                    <Form.Control
                                        as={"select"}
                                        multiple
                                        onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                                            const newQueue = Array.from(e.target.selectedOptions, option => parseInt(option.value));
                                            if (!newQueue.includes(this.state.queueIndex)) {
                                                this.updateState({
                                                    queue: newQueue,
                                                    queueIndex: newQueue[0]
                                                });
                                            } else {
                                                this.updateState({
                                                    queue: newQueue
                                                });
                                            }
                                        }}
                                        value={this.state.queue.map((q) => q.toString())}>
                                        {this.props.queue.map((q: string | PlayURL, index: number) => {
                                            return (
                                                <option key={getUrl(q)} value={index.toString()}>{q}</option>
                                            );
                                        })}
                                    </Form.Control>
                                </Col>
                            </Form.Group>

                            <Form.Group as={Row}>
                                <Form.Label column sm="2">
                                    Start queue at
                                </Form.Label>
                                <Col sm="10">
                                    <Form.Control
                                        as={"select"}
                                        onChange={(e) => {
                                            this.updateState({
                                                queueIndex: parseInt(e.target.value)
                                            });
                                        }}
                                        value={this.state.queueIndex}>
                                        {this.state.queue.map((q) => {
                                            return (
                                                <option key={q} value={q}>{this.props.queue[q]}</option>
                                            );
                                        })}
                                    </Form.Control>
                                </Col>
                            </Form.Group>
                        </> : <>
                            <Form.Group as={Row}>
                                <Form.Label column sm="2">
                                    URL
                                </Form.Label>
                                <Col sm="10">
                                    <InputGroup hasValidation={this.state.validated}>
                                        <Form.Control
                                            isValid={this.state.valid && this.state.validated}
                                            isInvalid={!this.state.valid && this.state.validated}
                                            onChange={(e) => {
                                                if (e.target.value === "") {
                                                    this.updateState({
                                                        url: "",
                                                        valid: false,
                                                        validated: false
                                                    });
                                                } else {
                                                    this.updateState({
                                                        url: e.target.value,
                                                        valid: canPlay(e.target.value),
                                                        validated: true
                                                    });
                                                }
                                            }}
                                            placeholder={"Link to media file"}
                                            required
                                            type={"text"}
                                            value={this.state.url}/>
                                        {this.state.valid ?
                                            <Form.Control.Feedback type={"valid"}>
                                                This seems playable
                                            </Form.Control.Feedback> :
                                            <Form.Control.Feedback type={"invalid"}>
                                                This doesn't seem to be a valid url or the provided media is unplayable
                                            </Form.Control.Feedback>
                                        }
                                    </InputGroup>
                                </Col>
                            </Form.Group>
                        </>
                    }

                    <hr/>

                    <Form.Group>
                        <Form.Label>
                            Resulting html-embed
                        </Form.Label>
                        <Form.Control
                            as={"textarea"}
                            readOnly={true}
                            ref={(input: HTMLTextAreaElement) => this.resultRef = input}
                            rows={6}
                            style={{
                                wordBreak: "break-all"
                            }}
                            value={this.state.result}
                        />
                    </Form.Group>
                </Modal.Body>

                <Modal.Footer>
                    <OverlayTrigger
                        trigger="click"
                        placement="top"
                        overlay={
                            <Popover id={"createEmbedModal-successMsg-popover"}>
                                <Popover.Content className={"text-success"}>
                                    Copied!
                                </Popover.Content>
                            </Popover>
                        }>
                        <Button variant="outline-success" onClick={this.copyToClipboard.bind(this)}>
                            <IoMdCopy style={{
                                marginTop: "-0.25em"
                            }}/> Copy code
                        </Button>
                    </OverlayTrigger>
                    <Button variant="secondary" onClick={this.props.onHide}>
                        Close
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

export default CreateEmbedModal;
