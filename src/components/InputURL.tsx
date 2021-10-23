import React from "react";
import {Button, Form, FormControl, InputGroup} from "react-bootstrap";
import {canPlay} from "../utils";

interface InputURLProps {
    children: JSX.Element | JSX.Element[] | string,
    className?: string,
    label: JSX.Element | JSX.Element[] | string,
    getRef?: (input: HTMLInputElement) => void,
    submit: (url: string) => void
}

interface InputURLState {
    url: string,
    valid: boolean,
    validated: boolean
}

class InputURL extends React.Component<InputURLProps, InputURLState> {
    constructor(props: InputURLProps) {
        super(props);

        this.state = {
            url: "",
            valid: false,
            validated: false
        };
    }

    render() {
        return (
            <Form noValidate className={this.props.className}
                  onSubmit={(e) => {
                      e.preventDefault();
                      if (this.state.url !== "" && this.state.valid) {
                          this.props.submit(this.state.url);
                          this.setState({
                              url: "",
                              valid: false,
                              validated: false
                          });
                      }
                  }}>
                <Form.Group className={"mb-1"}
                            controlId={"playable-url-input-group"}>
                    {this.props.label ?
                        <Form.Label>
                            {this.props.label}
                        </Form.Label>
                        : <></>}
                    <InputGroup hasValidation={this.state.validated}>
                        <FormControl type={"text"}
                                     value={this.state.url}
                                     placeholder={"URL to media"}
                                     required
                                     ref={(ref: HTMLInputElement) => {
                                         if (this.props.getRef) {
                                             this.props.getRef(ref);
                                         }
                                     }}
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
                                                 valid: canPlay(e.target.value),
                                                 validated: true
                                             });
                                         }
                                     }}
                                     isValid={this.state.valid && this.state.validated}
                                     isInvalid={!this.state.valid && this.state.validated}
                                     aria-describedby={"addItemQueue-modal-append"}/>
                        <InputGroup.Append>
                            <Button type={"submit"}
                                    id={"inputURL-button-append"}
                                    style={{
                                        borderBottomRightRadius: "0.25rem",
                                        borderTopRightRadius: "0.25rem"
                                    }}
                                    variant={"outline-success"}>
                                {this.props.children}
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
        );
    }
}

export default InputURL;
