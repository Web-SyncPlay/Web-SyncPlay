"use client"

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export function useRoomId() {
    const getRoomId = useCallback((path: string | null) => {
        if (path === null) {
            return null
        }

        if (path.startsWith("/room/")) {
            return path.replace("/room/", '').split("/")[0] ?? null
        }
        if (path.startsWith("/embed/")) {
            return path.replace("/embed/", '').split("/")[0] ?? null
        }
        return null
    }, [])

    const path = usePathname()
    const [roomId, setRoomId] = useState(getRoomId(path))

    useEffect(() => {
        const newRoomId = getRoomId(path)
        if (newRoomId !== roomId) {
            setRoomId(newRoomId)
        }
    }, [getRoomId, path, roomId])

    return roomId
}
