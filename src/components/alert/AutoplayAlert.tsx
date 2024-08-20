import Alert from "./Alert";
import Button from "../action/Button";
import { VolumeX } from "lucide-react";

interface Props {
  onClick: () => void;
}

export default function AutoplayAlert({ onClick }: Props) {
  return (
    <Alert className={"rounded opacity-90"}>
      Sound has been muted for autoplay
      <Button className={"mr-4 p-2"} onClick={onClick} tooltip={"Unmute"}>
        <VolumeX />
      </Button>
    </Alert>
  );
}
