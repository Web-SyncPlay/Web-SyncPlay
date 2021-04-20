import React from "react";
import {Container} from "react-bootstrap";
import "./Footer.css";
import {FaGithub} from "react-icons/all";

const Footer = () => {
    return (
        <footer className={"mt-auto p-2"}>
            <Container>
                Copyright (c) Leo Jung 2021
                <span className={"float-right"}>
                    <a href="https://github.com/yasamato/studi-watch" target="_blank" rel="noopener">
                        <span className={"icon"}>
                            <FaGithub/>
                        </span>
                        <span className={"d-none d-sm-inline-block ml-1"}>
                            Github
                        </span>
                    </a>
                </span>
            </Container>
        </footer>
    );
}

export default Footer;
