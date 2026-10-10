import { getAppNodeId } from "@/server/node-id"

/** Identifies this process so Redis pub/sub echoes are not double-delivered. */
export const BROADCAST_NODE_ID = getAppNodeId()
