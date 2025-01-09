import { Socket } from "net";
import { createServer } from "../src/socks5";

const server = createServer();

// start listening!
server.listen(1080);

interface DestinationInfo {
  address: string;
  port: number;
}

server.on("handshake", function (socket: Socket) {
  console.log();
  console.log("------------------------------------------------------------");
  console.log(
    "new socks5 client from %s:%d",
    socket.remoteAddress,
    socket.remotePort
  );
});

// When a reqest arrives for a remote destination
server.on(
  "proxyConnect",
  function (info: DestinationInfo, destination: Socket) {
    console.log("connected to remote server at %s:%d", info.address, info.port);

    destination.on("data", function (data: Buffer) {
      console.log(data.length);
    });
  }
);

server.on("proxyData", function (data: Buffer) {
  console.log(data.length);
});

// When an error occurs connecting to remote destination
server.on("proxyError", function (err: Error) {
  console.error("unable to connect to remote server");
  console.error(err);
});

// When a request for a remote destination ends
server.on(
  "proxyDisconnect",
  function (
    originInfo: DestinationInfo,
    destinationInfo: DestinationInfo,
    hadError: boolean
  ) {
    console.log(
      "client %s:%d request has disconnected from remote server at %s:%d with %serror",
      originInfo.address,
      originInfo.port,
      destinationInfo.address,
      destinationInfo.port,
      hadError ? "" : "no "
    );
  }
);

// When a proxy connection ends
server.on("proxyEnd", function (response: number, args: any) {
  console.log("socket closed with code %d", response);
  console.log(args);
  console.log();
});
