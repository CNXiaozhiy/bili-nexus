import { WebSocket } from "ws";

export type ListenerHandler<T> = (data: T, uninstall: () => void) => void;

const WebsocketUtils = {
  createWsListener<T = any>(
    ws: WebSocket,
    eventType: keyof WebSocketEventMap,
    handler: ListenerHandler<T>
  ) {
    const listener = (event: any) => {
      const uninstall = () => {
        ws.removeEventListener(eventType, listener);
      };
      handler(JSON.parse(event.toString()) as T, uninstall);
    };

    ws.on(eventType, listener);

    return () => {
      ws.off(eventType, listener);
    };
  },
};

export default WebsocketUtils;
