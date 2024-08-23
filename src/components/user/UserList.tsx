"use client";
import { type UserState } from "../../lib/types";
import UserItem from "./UserItem";
import { useController } from "~/lib/hooks/useController";

export default function UserList({ roomId }: { roomId: string }) {
  const { users, owner, socket, remote } = useController(roomId);

  return (
    <div
      className={
        "grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      }
    >
      {users.map((user) => (
        <UserItem
          user={user}
          socketId={socket.current?.id ?? ""}
          ownerId={owner}
          key={user.uid}
          updateName={(name) => {
            const newUser = JSON.parse(JSON.stringify(user)) as UserState;
            newUser.name = name;
            remote.updateUser(newUser);
          }}
        />
      ))}
    </div>
  );
}
