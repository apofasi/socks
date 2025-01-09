/// <reference types="jest" />
import { Duplex } from "stream";
import { SocksClient, SocksClientOptions } from "socks";
import * as http from "http";
import { createTargetServer, createTestSocks5Server } from "./utils";
import { Socket } from "net";

const TEST_HOST = "127.0.0.1";
const TEST_USERNAME = "testuser";
const TEST_PASSWORD = "testpass";

let mockServer: Awaited<ReturnType<typeof createTestSocks5Server>>["server"];
let targetServer: http.Server;
let proxyPort: number;
let targetPort: number;

beforeAll(async () => {
  // Setup SOCKS5 server with dynamic port and authentication
  const socks5Server = await createTestSocks5Server({
    authenticate: (
      username: string,
      password: string,
      socket: Socket,
      callback: (err?: Error) => void
    ) => {
      if (username === TEST_USERNAME && password === TEST_PASSWORD) {
        callback();
      } else {
        callback(new Error("Authentication failed"));
      }
    },
  });
  mockServer = socks5Server.server;
  proxyPort = socks5Server.port;

  // Setup target HTTP server
  const target = await createTargetServer();
  targetServer = target.server;
  targetPort = target.port;
});

afterAll((done) => {
  targetServer.close();
  mockServer.close();
  done();
});

describe("Socks5Client - With Authentication", () => {
  describe("createClient", () => {
    it("should create a client instance with valid auth options", async () => {
      const options: SocksClientOptions = {
        proxy: {
          host: TEST_HOST,
          port: proxyPort,
          type: 5,
          userId: TEST_USERNAME,
          password: TEST_PASSWORD,
        },
        command: "connect",
        destination: {
          host: TEST_HOST,
          port: targetPort,
        },
      };

      const { socket } = await SocksClient.createConnection(options);
      socket.destroy();
    });

    it("should throw error if auth credentials are missing", async () => {
      await expect(
        SocksClient.createConnection({
          proxy: {
            host: TEST_HOST,
            port: proxyPort,
            type: 5,
            // No auth credentials
          },
          command: "connect",
          destination: {
            host: TEST_HOST,
            port: targetPort,
          },
        })
      ).rejects.toThrow();
    });

    it("should throw error if auth credentials are incorrect", async () => {
      await expect(
        SocksClient.createConnection({
          proxy: {
            host: TEST_HOST,
            port: proxyPort,
            type: 5,
            userId: "wronguser",
            password: "wrongpass",
          },
          command: "connect",
          destination: {
            host: TEST_HOST,
            port: targetPort,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe("connect", () => {
    it("should successfully connect to target HTTP server through authenticated SOCKS5 proxy", async () => {
      const options: SocksClientOptions = {
        proxy: {
          host: TEST_HOST,
          port: proxyPort,
          type: 5,
          userId: TEST_USERNAME,
          password: TEST_PASSWORD,
        },
        command: "connect",
        destination: {
          host: TEST_HOST,
          port: targetPort,
        },
      };

      const { socket } = await SocksClient.createConnection(options);
      expect(socket).toBeInstanceOf(Duplex);
      expect(socket.readable).toBe(true);
      expect(socket.writable).toBe(true);

      // Test actual HTTP request through the SOCKS5 proxy
      return new Promise<void>((resolve, reject) => {
        socket.write(
          "GET / HTTP/1.1\r\n" +
            `Host: ${TEST_HOST}:${targetPort}\r\n` +
            "Connection: close\r\n" +
            "\r\n"
        );

        let response = "";
        socket.on("data", (chunk) => {
          response += chunk.toString();
        });

        socket.on("end", () => {
          expect(response).toContain("200 OK");
          expect(response).toContain("Hello from target server!");
          resolve();
        });

        socket.on("error", reject);
      });
    });

    it("should reject when destination port is invalid", async () => {
      const options: SocksClientOptions = {
        proxy: {
          host: TEST_HOST,
          port: proxyPort,
          type: 5,
          userId: TEST_USERNAME,
          password: TEST_PASSWORD,
        },
        command: "connect",
        destination: {
          host: TEST_HOST,
          port: -1,
        },
      };

      await expect(SocksClient.createConnection(options)).rejects.toThrow();
    });

    it("should reject when destination host is invalid", async () => {
      const options: SocksClientOptions = {
        proxy: {
          host: TEST_HOST,
          port: proxyPort,
          type: 5,
          userId: TEST_USERNAME,
          password: TEST_PASSWORD,
        },
        command: "connect",
        destination: {
          host: "invalid",
          port: targetPort,
        },
      };

      await expect(SocksClient.createConnection(options)).rejects.toThrow();
    });

    it("should reject when proxy server is unreachable", async () => {
      const options: SocksClientOptions = {
        proxy: {
          host: TEST_HOST,
          port: proxyPort + 1, // Wrong port
          type: 5,
          userId: TEST_USERNAME,
          password: TEST_PASSWORD,
        },
        command: "connect",
        destination: {
          host: TEST_HOST,
          port: targetPort,
        },
      };

      await expect(SocksClient.createConnection(options)).rejects.toThrow();
    });

    it("should reject when destination is unreachable", async () => {
      const options: SocksClientOptions = {
        proxy: {
          host: TEST_HOST,
          port: proxyPort,
          type: 5,
          userId: TEST_USERNAME,
          password: TEST_PASSWORD,
        },
        command: "connect",
        destination: {
          host: TEST_HOST,
          port: 1, // Wrong port
        },
      };

      await expect(SocksClient.createConnection(options)).rejects.toThrow();
    });
  });
});
