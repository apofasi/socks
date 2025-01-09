/// <reference types="jest" />
import {
  createTargetServer,
  createTestSocks5Server,
  curlThroughProxies,
} from "./utils";
import { Socket } from "net";
import { SocksClient } from "socks";
import { Duplex } from "stream";

const TEST_HOST = "127.0.0.1";
const TEST_USERNAME = "testuser";
const TEST_PASSWORD = "testpass";

describe("SOCKS5 Proxy Chain", () => {
  describe("Multiple Proxy Chain", () => {
    it("should successfully connect through multiple proxies to target server", async () => {
      // Create target HTTP server (Server 1)
      const target = await createTargetServer();
      const targetUrl = `http://${TEST_HOST}:${target.port}`;

      // Create authenticated proxy (Server 2)
      const authProxy = await createTestSocks5Server({
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

      // Create non-authenticated proxy (Server 3) with socketFactory to connect through authProxy
      const noAuthProxy = await createTestSocks5Server({
        socketFactory: async (
          destinationAddress: string,
          destinationPort: number
        ): Promise<Duplex> => {
          // Connect to the destination through the authenticated proxy
          const { socket } = await SocksClient.createConnection({
            proxy: {
              host: TEST_HOST,
              port: authProxy.port,
              type: 5,
              userId: TEST_USERNAME,
              password: TEST_PASSWORD,
            },
            command: "connect",
            destination: {
              host: destinationAddress,
              port: destinationPort,
            },
          });
          return socket;
        },
      });

      try {
        // Execute request through first proxy only, it will internally use the second proxy
        const response = await curlThroughProxies(targetUrl, [
          {
            host: TEST_HOST,
            port: noAuthProxy.port,
          },
        ]);

        // Assert the response
        expect(response).toBe("Hello from target server!");
      } finally {
        // Cleanup
        target.server.close();
        authProxy.server.close();
        noAuthProxy.server.close();
      }
    }, 10000); // Increase timeout for complex setup
  });
});
