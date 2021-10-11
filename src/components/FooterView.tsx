import React from "react";
import {Container} from "react-bootstrap";
import "./Footer.css";
import {FaGithub} from "react-icons/all";

const FooterView = () => {
    return (
        <footer className={"mt-auto p-2"}>
            <Container>
                Made by <a href={"https://github.com/Yasamato"}>
                Yasamato
            </a> 2021, Images by <a href="https://icons8.com/">Icons8</a>
                <span className={"float-right"}>
                    <a href="https://github.com/Web-SyncPlay/Web-SyncPlay" target="_blank" rel={"noreferrer"}>
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
};

export default FooterView;
