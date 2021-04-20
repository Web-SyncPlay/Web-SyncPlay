import React from "react";
import "./App.css";
import NavbarHeader from "./components/NavbarHeader";
import StartModal from "./components/StartModal";
import Room from "./components/Room";
import Footer from "./components/Footer";

const debugUrl = "http://localhost:8081";

interface AppProps {

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
            roomId: ""
        }

        this.roomRef = React.createRef<Room>();
    }

    generateNewRoom() {
        fetch(debugUrl + "/room/generate")
            .then(res => res.json())
            .then(id => {
                this.setState({
                    isRoom: true,
                    roomId: id.id
                })
            })
    }

    playURL(url: string) {
        this.roomRef.current?.changeToURL(url);
    }

    joinRoom(roomId: string) {
        this.setState({roomId: roomId})
    }

    render() {
        return (
            <div className="App">
                <NavbarHeader isRoom={this.state.isRoom} roomId={this.state.roomId} playURL={this.playURL.bind(this)}/>
                {this.state.isRoom ? (
                    <Room ref={this.roomRef} roomId={this.state.roomId}/>
                ) : (
                    <StartModal generateRoom={this.generateNewRoom.bind(this)} joinRoom={this.joinRoom.bind(this)}/>
                )}
                <Footer/>
            </div>
        );
    }
}

export default App;
