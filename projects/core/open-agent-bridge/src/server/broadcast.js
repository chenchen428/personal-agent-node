export class BrowserHub {
  constructor() {
    this.sockets = new Set();
  }

  add(socket) {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
  }

  broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const socket of this.sockets) {
      if (socket.readyState === 1) socket.send(text);
    }
  }
}
