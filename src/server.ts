import {
  RFC_1928_ATYP,
  RFC_1928_COMMANDS,
  RFC_1928_METHODS,
  RFC_1928_REPLIES,
  RFC_1928_VERSION,
  RFC_1929_REPLIES,
  RFC_1929_VERSION,
} from "./constants";

import net, { Socket, Server } from "net";
import { Duplex } from "stream";
import {
  parseAuthRequest,
  parseConnectRequest,
  parseIPv4Address,
  parseIPv6Address,
  parseDomainName,
} from "./binary";

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
        const request = parseAuthRequest(buffer);

        // verify version is appropriate
        if (request.ver !== RFC_1929_VERSION) {
          return end(RFC_1929_REPLIES.GENERAL_FAILURE, request);
        }

        // perform authentication
        if (self.options.authenticate) {
          self.options.authenticate(
            request.uname.toString(),
            request.passwd.toString(),
            socket,
            (err?: Error) => {
              if (err) {
                // emit failed authentication event
                self.server.emit(
                  EVENTS.AUTHENTICATION_ERROR,
                  request.uname.toString(),
                  err
                );
                // respond with auth failure
                return end(RFC_1929_REPLIES.GENERAL_FAILURE, request);
              }

              // emit successful authentication event
              self.server.emit(EVENTS.AUTHENTICATION, request.uname.toString());

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
      }

      /**
       * +----+-----+-------+------+----------+----------+
       * |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
       * +----+-----+-------+------+----------+----------+
       * | 1  |  1  | X'00' |  1   | Variable |    2     |
       * +----+-----+-------+------+----------+----------+
       **/
      function connect(buffer: Buffer): void {
        const request = parseConnectRequest(buffer);

        // verify version is appropriate
        if (request.ver !== RFC_1928_VERSION) {
          return end(RFC_1928_REPLIES.GENERAL_FAILURE, request);
        }

        // append socket to active sessions
        self.activeSessions.push(socket);

        let dst = { addr: "", port: 0 };

        // ipv4
        if (request.atyp === RFC_1928_ATYP.IPV4) {
          dst.addr = parseIPv4Address(request.remaining.subarray(0, 4));
          dst.port = request.remaining.readUInt16BE(4);
        }
        // domain name
        else if (request.atyp === RFC_1928_ATYP.DOMAINNAME) {
          const domain = parseDomainName(request.remaining);
          dst.addr = domain.addr;
          dst.port = request.remaining.readUInt16BE(domain.size + 1);
        }
        // ipv6
        else if (request.atyp === RFC_1928_ATYP.IPV6) {
          dst.addr = parseIPv6Address(request.remaining.subarray(0, 16));
          dst.port = request.remaining.readUInt16BE(16);
        }
        // unsupported address type
        else {
          return end(RFC_1928_REPLIES.ADDRESS_TYPE_NOT_SUPPORTED, request);
        }

        // create outbound socket
        const outboundSocket = self.options.socketFactory
          ? self.options.socketFactory(dst.addr, dst.port)
          : defaultSocketFactory(dst.addr, dst.port);

        // handle connection response
        outboundSocket
          .then((targetSocket) => {
            // prepare response
            const responseBuffer = Buffer.allocUnsafe(
              request.requestBuffer.length
            );
            responseBuffer[0] = RFC_1928_VERSION;
            responseBuffer[1] = RFC_1928_REPLIES.SUCCEEDED;
            responseBuffer[2] = 0x00;

            // copy the remaining buffer from the request
            request.requestBuffer.copy(responseBuffer, 3, 3);

            // write response and establish proxy
            socket.write(responseBuffer, () => {
              targetSocket.pipe(socket);
              socket.pipe(targetSocket);
            });
          })
          .catch((err) => {
            end(RFC_1928_REPLIES.GENERAL_FAILURE, request);
            self.server.emit(EVENTS.PROXY_ERROR, err);
          });
      }

      function end(code: number, args: { requestBuffer: Buffer }): void {
        // prepare response
        const responseBuffer = Buffer.allocUnsafe(2);
        responseBuffer[0] = RFC_1928_VERSION;
        responseBuffer[1] = code;

        // write response and end socket
        socket.write(responseBuffer, () => socket.end());
      }

      // capture the handshake and allow for authentication if configured
      socket.once("data", (buffer) => {
        // verify version and auth methods
        if (buffer[0] !== RFC_1928_VERSION || buffer[1] !== buffer.length - 2) {
          return end(RFC_1928_REPLIES.GENERAL_FAILURE, {
            requestBuffer: buffer,
          });
        }

        // convert methods buffer to array
        const methods = Array.prototype.slice.call(buffer, 2);

        // ensure options.authenticate is properly setup if authentication method is requested
        if (
          methods.includes(RFC_1928_METHODS.BASIC_AUTHENTICATION) &&
          !self.options.authenticate
        ) {
          return end(RFC_1928_REPLIES.GENERAL_FAILURE, {
            requestBuffer: buffer,
          });
        }

        // if authentication is configured and the client supports it, use it
        if (
          self.options.authenticate &&
          methods.includes(RFC_1928_METHODS.BASIC_AUTHENTICATION)
        ) {
          // respond with basic auth request
          const responseBuffer = Buffer.from([
            RFC_1928_VERSION,
            RFC_1928_METHODS.BASIC_AUTHENTICATION,
          ]);

          // write response and await authentication
          return socket.write(responseBuffer, () => {
            socket.once("data", authenticate);
          });
        }

        // if no authentication is configured and client supports it, use it
        if (
          !self.options.authenticate &&
          methods.includes(RFC_1928_METHODS.NO_AUTHENTICATION_REQUIRED)
        ) {
          // respond with no auth required
          const responseBuffer = Buffer.from([
            RFC_1928_VERSION,
            RFC_1928_METHODS.NO_AUTHENTICATION_REQUIRED,
          ]);

          // write response and await connection details
          return socket.write(responseBuffer, () => {
            socket.once("data", connect);
          });
        }

        // no supported authentication methods
        return end(RFC_1928_METHODS.NO_ACCEPTABLE_METHODS, {
          requestBuffer: buffer,
        });
      });
    });
  }

  /**
   * Closes the server and all active sessions
   */
  close(callback?: (err?: Error) => void): void {
    this.activeSessions.forEach((session) => session.end());
    this.server.close(callback);
  }

  /**
   * Returns the address the server is listening on
   */
  address() {
    return this.server.address();
  }

  /**
   * Start listening for connections on the given port and host
   */
  listen(port: number, host?: string, callback?: () => void): void {
    this.server.listen(port, host, callback);
  }
}

/**
 * Creates a new SOCKS5 server instance
 */
export function createServer(options?: SocksServerOptions): SocksServer {
  return new SocksServer(options);
}
