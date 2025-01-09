import {
  RFC_1928_ATYP,
  RFC_1928_COMMANDS,
  RFC_1928_METHODS,
  RFC_1928_REPLIES,
  RFC_1928_VERSION,
  RFC_1929_REPLIES,
  RFC_1929_VERSION,
} from "./constants";

import binary from "binary";
import net, { Socket, Server } from "net";
import { Duplex } from "stream";

// Define interfaces and types
export interface SocksServerOptions {
  authenticate?: (
    username: string,
    password: string,
    socket: Socket,
    callback: (err?: Error) => void
  ) => void;
  connectionFilter?: (
    destination: { address: string; port: number },
    origin: { address: string; port: number },
    callback: (err?: Error) => void
  ) => void;
  socketFactory?: (address: string, port: number) => Promise<Duplex>;
}

function defaultSocketFactory(address: string, port: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, address, () => {
      socket.removeListener("error", handleError);
      resolve(socket);
    });
    const handleError = (err: any) => {
      socket.removeListener("error", handleError);
      reject(err);
    };
    socket.once("error", handleError);
  });
}

interface BinaryStreamArgs {
  ver: number;
  cmd?: number;
  rsv?: number;
  atyp?: number;
  requestBuffer?: Buffer;
  dst?: {
    addr?: string;
    port?: number;
  };
  addr?: {
    buf?: Buffer;
    size?: number;
    a?: number;
    b?: number;
    c?: number;
    d?: number;
  };
  ulen?: number;
  uname?: Buffer;
  plen?: number;
  passwd?: Buffer;
  methods?: Buffer;
  nmethods?: number;
}

// Module specific events
export const EVENTS = {
  AUTHENTICATION: "authenticate",
  AUTHENTICATION_ERROR: "authenticateError",
  CONNECTION_FILTER: "connectionFilter",
  HANDSHAKE: "handshake",
  PROXY_CONNECT: "proxyConnect",
  PROXY_DATA: "proxyData",
  PROXY_DISCONNECT: "proxyDisconnect",
  PROXY_END: "proxyEnd",
  PROXY_ERROR: "proxyError",
} as const;

const LENGTH_RFC_1928_ATYP = 4;

/**
 * The following RFCs may be useful as background:
 *
 * https://www.ietf.org/rfc/rfc1928.txt - NO_AUTH SOCKS5
 * https://www.ietf.org/rfc/rfc1929.txt - USERNAME/PASSWORD SOCKS5
 *
 **/
export class SocksServer {
  private activeSessions: Socket[];
  private options: SocksServerOptions;
  public server: Server;

  constructor(options?: SocksServerOptions) {
    const self = this;

    this.activeSessions = [];
    this.options = options || {};
    this.server = net.createServer((socket: Socket) => {
      socket.on("error", (err: Error) => {
        self.server.emit(EVENTS.PROXY_ERROR, err);
      });

      /**
       * +----+------+----------+------+----------+
       * |VER | ULEN |  UNAME   | PLEN |  PASSWD  |
       * +----+------+----------+------+----------+
       * | 1  |  1   | 1 to 255 |  1   | 1 to 255 |
       * +----+------+----------+------+----------+
       **/
      function authenticate(buffer: Buffer): void {
        binary
          .stream(buffer)
          .word8("ver")
          .word8("ulen")
          .buffer("uname", "ulen")
          .word8("plen")
          .buffer("passwd", "plen")
          .tap((args: BinaryStreamArgs) => {
            // capture the raw buffer
            args.requestBuffer = buffer;

            // verify version is appropriate
            if (args.ver !== RFC_1929_VERSION) {
              return end(RFC_1929_REPLIES.GENERAL_FAILURE, args);
            }

            // perform authentication
            if (self.options.authenticate) {
              self.options.authenticate(
                args.uname!.toString(),
                args.passwd!.toString(),
                socket,
                (err?: Error) => {
                  if (err) {
                    // emit failed authentication event
                    self.server.emit(
                      EVENTS.AUTHENTICATION_ERROR,
                      args.uname!.toString(),
                      err
                    );
                    // respond with auth failure
                    return end(RFC_1929_REPLIES.GENERAL_FAILURE, args);
                  }

                  // emit successful authentication event
                  self.server.emit(
                    EVENTS.AUTHENTICATION,
                    args.uname!.toString()
                  );

                  // respond with success...
                  const responseBuffer = Buffer.allocUnsafe(2);
                  responseBuffer[0] = RFC_1929_VERSION;
                  responseBuffer[1] = RFC_1929_REPLIES.SUCCEEDED;

                  // respond then listen for cmd and dst info
                  socket.write(responseBuffer, () => {
                    // now listen for more details
                    socket.once("data", connect);
                  });
                }
              );
            }
          });
      }

      /**
       * +----+-----+-------+------+----------+----------+
       * |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
       * +----+-----+-------+------+----------+----------+
       * | 1  |  1  | X'00' |  1   | Variable |    2     |
       * +----+-----+-------+------+----------+----------+
       **/
      function connect(buffer: Buffer): void {
        const binaryStream = binary.stream(buffer);

        binaryStream
          .word8("ver")
          .word8("cmd")
          .word8("rsv")
          .word8("atyp")
          .tap((args: BinaryStreamArgs) => {
            // capture the raw buffer
            args.requestBuffer = buffer;

            // verify version is appropriate
            if (args.ver !== RFC_1928_VERSION) {
              return end(RFC_1928_REPLIES.GENERAL_FAILURE, args);
            }

            // append socket to active sessions
            self.activeSessions.push(socket);

            // create dst
            args.dst = {};

            // ipv4
            if (args.atyp === RFC_1928_ATYP.IPV4) {
              binaryStream
                .buffer("addr.buf", LENGTH_RFC_1928_ATYP)
                .tap((args: BinaryStreamArgs) => {
                  args.dst!.addr = Array.from(args.addr!.buf!).join(".");
                });

              // domain name
            } else if (args.atyp === RFC_1928_ATYP.DOMAINNAME) {
              binaryStream
                .word8("addr.size")
                .buffer("addr.buf", "addr.size")
                .tap((args: BinaryStreamArgs) => {
                  args.dst!.addr = args.addr!.buf!.toString();
                });

              // ipv6
            } else if (args.atyp === RFC_1928_ATYP.IPV6) {
              binaryStream
                .word32be("addr.a")
                .word32be("addr.b")
                .word32be("addr.c")
                .word32be("addr.d")
                .tap((args: BinaryStreamArgs) => {
                  const ipv6Parts: string[] = [];

                  // extract the parts of the ipv6 address
                  ["a", "b", "c", "d"].forEach((x) => {
                    const value = args.addr![
                      x as keyof typeof args.addr
                    ] as number;

                    // convert DWORD to two WORD values and append
                    /* eslint no-magic-numbers : 0 */
                    ipv6Parts.push((value >>> 16).toString(16));
                    ipv6Parts.push((value & 0xffff).toString(16));
                  });

                  // format ipv6 address as string
                  if (args.dst) {
                    args.dst.addr = ipv6Parts.join(":");
                  }
                });

              // unsupported address type
            } else {
              return end(RFC_1928_REPLIES.ADDRESS_TYPE_NOT_SUPPORTED, args);
            }
          })
          .word16bu("dst.port")
          .tap((args: BinaryStreamArgs) => {
            if (args.cmd === RFC_1928_COMMANDS.CONNECT) {
              let connectionFilter = self.options.connectionFilter;

              // if no connection filter is provided, stub one
              if (!connectionFilter || typeof connectionFilter !== "function") {
                connectionFilter = (destination, origin, callback) =>
                  setImmediate(callback);
              }

              // perform connection
              connectionFilter(
                // destination
                {
                  address: args.dst!.addr!,
                  port: args.dst!.port!,
                },
                // origin
                {
                  address: socket.remoteAddress!,
                  port: socket.remotePort!,
                },
                (err?: Error) => {
                  if (err) {
                    // emit failed destination connection event
                    self.server.emit(
                      EVENTS.CONNECTION_FILTER,
                      // destination
                      {
                        address: args.dst!.addr,
                        port: args.dst!.port,
                      },
                      // origin
                      {
                        address: socket.remoteAddress,
                        port: socket.remotePort,
                      },
                      err
                    );

                    // respond with failure
                    return end(RFC_1928_REPLIES.CONNECTION_NOT_ALLOWED, args);
                  }

                  const socketFactory =
                    self.options.socketFactory || defaultSocketFactory;

                  const destinationInfo = {
                    address: args.dst!.addr!,
                    port: args.dst!.port!,
                  };

                  const originInfo = {
                    address: socket.remoteAddress!,
                    port: socket.remotePort!,
                  };

                  socketFactory(args.dst!.addr!, args.dst!.port!)
                    .then((destination: Duplex) => {
                      // emit connection event
                      self.server.emit(
                        EVENTS.PROXY_CONNECT,
                        destinationInfo,
                        destination
                      );

                      // emit connection event
                      self.server.emit(
                        EVENTS.PROXY_CONNECT,
                        destinationInfo,
                        destination
                      );

                      // capture and emit proxied connection data
                      destination.on("data", (data: Buffer) => {
                        self.server.emit(EVENTS.PROXY_DATA, data);
                      });

                      // capture close of destination and emit pending disconnect
                      // note: this event is only emitted once the destination socket is fully closed
                      destination.on("close", (hadError: boolean) => {
                        // indicate client connection end
                        self.server.emit(
                          EVENTS.PROXY_DISCONNECT,
                          originInfo,
                          destinationInfo,
                          hadError
                        );
                      });

                      // prepare a success response
                      const responseBuffer = Buffer.alloc(
                        args.requestBuffer!.length
                      );
                      args.requestBuffer!.copy(responseBuffer);
                      responseBuffer[1] = RFC_1928_REPLIES.SUCCEEDED;

                      // write acknowledgement to client...
                      socket.write(responseBuffer, () => {
                        // listen for data bi-directionally
                        destination.pipe(socket);
                        socket.pipe(destination);
                      });

                      destination.on(
                        "error",
                        (
                          err: Error & {
                            code?: string;
                            addr?: string;
                            atyp?: number;
                            port?: number;
                          }
                        ) => {
                          // notify of connection error
                          err.addr = args.dst!.addr;
                          err.atyp = args.atyp;
                          err.port = args.dst!.port;

                          self.server.emit(EVENTS.PROXY_ERROR, err);

                          if (err.code && err.code === "EADDRNOTAVAIL") {
                            return end(RFC_1928_REPLIES.HOST_UNREACHABLE, args);
                          }

                          if (err.code && err.code === "ECONNREFUSED") {
                            return end(
                              RFC_1928_REPLIES.CONNECTION_REFUSED,
                              args
                            );
                          }

                          return end(
                            RFC_1928_REPLIES.NETWORK_UNREACHABLE,
                            args
                          );
                        }
                      );
                    })
                    .catch((err) => {
                      self.server.emit(EVENTS.PROXY_ERROR, err);

                      if (err.code && err.code === "EADDRNOTAVAIL") {
                        return end(RFC_1928_REPLIES.HOST_UNREACHABLE, args);
                      }

                      if (err.code && err.code === "ECONNREFUSED") {
                        return end(RFC_1928_REPLIES.CONNECTION_REFUSED, args);
                      }

                      return end(RFC_1928_REPLIES.NETWORK_UNREACHABLE, args);
                    });
                }
              );
            } else {
              // bind and udp associate commands
              return end(RFC_1928_REPLIES.SUCCEEDED, args);
            }
          });
      }

      /**
       * +----+-----+-------+------+----------+----------+
       * |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
       * +----+-----+-------+------+----------+----------+
       * | 1  |  1  | X'00' |  1   | Variable |    2     |
       * +----+-----+-------+------+----------+----------+
       **/
      function end(response: number, args: BinaryStreamArgs): void {
        // either use the raw buffer (if available) or create a new one
        const responseBuffer = args.requestBuffer || Buffer.allocUnsafe(2);

        if (!args.requestBuffer) {
          responseBuffer[0] = RFC_1928_VERSION;
        }

        responseBuffer[1] = response;

        // respond then end the connection
        try {
          socket.end(responseBuffer);
        } catch (ex) {
          socket.destroy();
        }

        // indicate end of connection
        self.server.emit(EVENTS.PROXY_END, response, args);
      }

      /**
       * +----+----------+----------+
       * |VER | NMETHODS | METHODS  |
       * +----+----------+----------+
       * | 1  |    1     | 1 to 255 |
       * +----+----------+----------+
       **/
      function handshake(buffer: Buffer): void {
        binary
          .stream(buffer)
          .word8("ver")
          .word8("nmethods")
          .buffer("methods", "nmethods")
          .tap((args: BinaryStreamArgs) => {
            // verify version is appropriate
            if (args.ver !== RFC_1928_VERSION) {
              return end(RFC_1928_REPLIES.GENERAL_FAILURE, args);
            }

            // convert methods buffer to an array
            const acceptedMethods = Array.from(
              args.methods || Buffer.alloc(0)
            ).reduce((methods: { [key: number]: boolean }, method: number) => {
              methods[method] = true;
              return methods;
            }, {});

            const basicAuth = typeof self.options.authenticate === "function";
            let next = connect;
            const noAuth =
              !basicAuth &&
              typeof acceptedMethods[0] !== "undefined" &&
              acceptedMethods[0];

            const responseBuffer = Buffer.allocUnsafe(2);

            // form response Buffer
            responseBuffer[0] = RFC_1928_VERSION;
            responseBuffer[1] = RFC_1928_METHODS.NO_AUTHENTICATION_REQUIRED;

            // check for basic auth configuration
            if (basicAuth) {
              responseBuffer[1] = RFC_1928_METHODS.BASIC_AUTHENTICATION;
              next = authenticate;

              // if NO AUTHENTICATION REQUIRED and
            } else if (!basicAuth && noAuth) {
              responseBuffer[1] = RFC_1928_METHODS.NO_AUTHENTICATION_REQUIRED;
              next = connect;

              // basic auth callback not provided and no auth is not supported
            } else {
              return end(RFC_1928_METHODS.NO_ACCEPTABLE_METHODS, args);
            }

            // respond then listen for cmd and dst info
            socket.write(responseBuffer, () => {
              // emit handshake event
              self.server.emit(EVENTS.HANDSHAKE, socket);

              // now listen for more details
              socket.once("data", next);
            });
          });
      }

      // capture the client handshake
      socket.once("data", handshake);

      // capture socket closure
      socket.once("end", () => {
        // remove the session from currently the active sessions list
        self.activeSessions.splice(self.activeSessions.indexOf(socket), 1);
      });
    });
  }
}

export const createServer = (options?: SocksServerOptions): Server => {
  const socksServer = new SocksServer(options);
  return socksServer.server;
};
