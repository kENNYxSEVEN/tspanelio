import { io } from "socket.io-client"

const websocketUri =
  import.meta.env.DEV && import.meta.env.VITE_WEBSOCKET_URI
    ? import.meta.env.VITE_WEBSOCKET_URI
    : undefined

export const socket = io(websocketUri, {
  path: "/socket.io",
})