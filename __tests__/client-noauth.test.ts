/// <reference types="jest" />
import { Duplex } from "stream";
import { SocksClient, SocksClientOptions } from "socks";
import * as http from "http";
import { createTargetServer, createTestSocks5Server } from "./utils";

const TEST_HOST = "127.0.0.1";
let mockServer: Awaited<ReturnType<typeof createTestSocks5Server>>["server"];
let targetServer: http.Server;
let proxyPort: number;
let targetPort: number;

beforeAll(async () => {
  // Setup SOCKS5 server with dynamic port
  const socks5Server = await createTestSocks5Server();
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

describe("Socks5Client - No Authentication", () => {
  describe("createClient", () => {
    it("should create a client instance with valid options", async () => {
      const options: SocksClientOptions = {
        proxy: {
          host: TEST_HOST,
          port: proxyPort,
          type: 5,
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

    it("should throw error if port is invalid", async () => {
      await expect(
        SocksClient.createConnection({
          proxy: {
            host: TEST_HOST,
            port: -1,
            type: 5,
          },
          command: "connect",
          destination: {
            host: TEST_HOST,
            port: targetPort,
          },
        })
      ).rejects.toThrow();
    });

    it("should throw error if host is empty", async () => {
      await expect(
        SocksClient.createConnection({
          proxy: {
            host: "invalid",
            port: proxyPort,
            type: 5,
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
    it("should successfully connect to target HTTP server through SOCKS5 proxy", async () => {
      const options: SocksClientOptions = {
        proxy: {
          host: TEST_HOST,
          port: proxyPort,
          type: 5,
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
        },
        command: "connect",
        destination: {
          host: TEST_HOST,
          port: -1,
        },
      };

      await expect(SocksClient.createConnection(options)).rejects.toThrow();
    });

    it("should reject when destination host is empty", async () => {
      const options: SocksClientOptions = {
        proxy: {
          host: TEST_HOST,
          port: proxyPort,
          type: 5,
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
