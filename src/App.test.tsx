import React from "react";
import {render, screen} from "@testing-library/react";
import {RouterApp} from "./App";

test("renders learn react link", () => {
    render(<RouterApp/>);
    const linkElement = screen.getByText(/learn react/i);
    expect(linkElement).toBeInTheDocument();
});
