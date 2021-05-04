import React from "react";
import ReactDOM from "react-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import {RouterApp} from "./App";
import {BrowserRouter} from "react-router-dom";

ReactDOM.render(
    <React.StrictMode>
        <BrowserRouter>
            <RouterApp/>
        </BrowserRouter>
    </React.StrictMode>,
    document.getElementById("root")
);
