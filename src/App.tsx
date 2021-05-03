import React from "react";
import "./App.css";
import NavbarHeader from "./components/NavbarHeader";
import StartModal from "./components/StartModal";
import Room from "./components/Room";
import Footer from "./components/Footer";
import {Route, useHistory, useLocation} from "react-router-dom";
import * as H from "history";
import Switch from "react-bootstrap/Switch";

interface AppProps {
    history: H.History,
    location: H.Location
}

interface AppState {
    isRoom: boolean,
    roomId: string
}

class App extends React.Component<AppProps> {
    state: AppState;
    roomRef: React.RefObject<Room>;

    constructor(props: AppProps) {
        super(props);
        this.state = {
            isRoom: false,
            roomId: props.location.pathname.replace("/room/", "")
        };

        this.roomRef = React.createRef<Room>();
    }

    joinRoom(id: string) {
        this.setState({
            isRoom: true,
            roomId: id
        });
        this.props.history.push("/room/" + id);
    }

    playURL(url: string) {
        this.roomRef.current?.changeToURL(url);
    }

    render() {
        return (
            <div className="App">
                <NavbarHeader isRoom={this.state.isRoom}
                              roomId={this.state.roomId}
                              playURL={this.playURL.bind(this)}/>
                <Switch>
                    <Route exact path={"/"}>
                        <StartModal join={this.joinRoom.bind(this)}/>
                    </Route>
                    <Route path={"/room/:roomId"}>
                        <Room ref={this.roomRef} roomId={this.state.roomId}/>
                    </Route>
                </Switch>
                <Footer/>
            </div>
        );
    }
}

export const RouterApp = () => {
    const history = useHistory();
    const location = useLocation();
    return (
        <App history={history} location={location}/>
    );
};

export default App;
