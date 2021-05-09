import React from "react";
import {Button, Form, FormControl, InputGroup, Navbar} from "react-bootstrap";
import "./NavbarHeader.css";
import {IoShareSocial} from "react-icons/all";
import InviteModal from "./modal/InviteModal";
import {Link, Route, Switch} from "react-router-dom";

interface NavbarHeaderProps {
    isRoom: boolean,
    roomId: string,
    playURL: (url: string) => void
}

interface NavbarHeaderState {
    url: string,
    inviteModalOpen: boolean
}

class NavbarHeader extends React.Component<NavbarHeaderProps, NavbarHeaderState> {
    constructor(props: NavbarHeaderProps) {
        super(props);

        this.state = {
            inviteModalOpen: false,
            url: ""
        };
    }

    render() {
        // TODO: this is not very ideal...
        return (
            <>
                <Navbar collapseOnSelect expand={"md"} variant="dark" className={"mb-1"}>
                    <Link to={"/"} className={"navbar-brand"}>
                        <img alt={"Logo of Web-SyncPlay"}
                             src={"/logo_white.png"}
                             style={{
                                 height: "2em",
                                 width: "2em"
                             }}/>
                    </Link>
                    <Navbar.Toggle className={"ml-auto"} aria-controls="responsive-navbar-nav"/>
                    <Navbar.Collapse id="responsive-navbar-nav">
                        <Switch>
                            <Route path={"/room/:roomId"}>
                                <Form className={"w-100"}
                                      onSubmit={(e) => {
                                          e.preventDefault();
                                          if (this.state.url !== "") {
                                              this.props.playURL(this.state.url);
                                              this.setState({url: ""});
                                          }
                                      }}
                                      inline>
                                    <InputGroup className={"mr-2"}>
                                        <FormControl
                                            value={this.state.url}
                                            onChange={(e) => this.setState({url: e.target.value})}
                                            placeholder={"Link to media file"}
                                            aria-label={"Link to media file"}
                                            aria-describedby={"urlInput-button"}
                                        />
                                        <InputGroup.Append id={"urlInput-button"}>
                                            <Button variant="outline-success" type={"submit"}>
                                                Play
                                            </Button>
                                        </InputGroup.Append>
                                    </InputGroup>
                                    <Button className={"ml-auto"}
                                            onClick={() => this.setState({inviteModalOpen: true})}
                                            variant={"success"}>
                                        <IoShareSocial style={{
                                            marginTop: "-0.25em"
                                        }}/>
                                        <span className={"ml-1"}>
                                                Share
                                            </span>
                                    </Button>
                                </Form>
                            </Route>
                        </Switch>
                    </Navbar.Collapse>
                </Navbar>
                <InviteModal roomId={this.props.roomId}
                             show={this.state.inviteModalOpen}
                             closeModal={() => this.setState({inviteModalOpen: false})}/>
            </>
        );
    }
}

export default NavbarHeader;
