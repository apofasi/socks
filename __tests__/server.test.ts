/// <reference types="jest" />
import { createServer } from "../src/server";
import { Server } from "net";
import http from "http";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

describe("SOCKS5 Server Tests", () => {
  let socksServer: Server;
  let httpServer: http.Server;
  const SOCKS_PORT = 1080;
  const HTTP_PORT = 8080;
  const TEST_USERNAME = "testuser";
  const TEST_PASSWORD = "testpass";

  describe("No Authentication Tests", () => {
    beforeAll((done) => {
      // Create and start SOCKS server without authentication
      socksServer = createServer();
      socksServer.listen(SOCKS_PORT, "127.0.0.1", () => {
        console.log(`SOCKS server listening on port ${SOCKS_PORT}`);
      });

      // Create and start HTTP server
      httpServer = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Hello from HTTP Server!" }));
      });

      httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
        console.log(`HTTP server listening on port ${HTTP_PORT}`);
        done();
      });
    });

    afterAll((done) => {
      // Cleanup: Close both servers
      socksServer.close(() => {
        httpServer.close(() => {
          done();
        });
      });
    });

    it("should successfully proxy HTTP request through SOCKS server without auth", async () => {
      const curlCommand = `curl -v -x socks5h://127.0.0.1:${SOCKS_PORT} http://127.0.0.1:${HTTP_PORT}`;

      try {
        const { stdout, stderr } = await execAsync(curlCommand);

        // Parse the response
        const response = JSON.parse(stdout);

        // Verify the response contains the expected message
        expect(response).toHaveProperty("message");
        expect(response.message).toBe("Hello from HTTP Server!");
      } catch (error) {
        console.error("Error executing curl command:", error);
        throw error;
      }
    }, 10000);

    it("should handle connection to non-existent server gracefully", async () => {
      const curlCommand = `curl -v -x socks5h://127.0.0.1:${SOCKS_PORT} http://127.0.0.1:9999`;

      let commandError: Error | null = null;
      try {
        await execAsync(curlCommand);
      } catch (error) {
        commandError = error as Error;
      }

      // We expect the command to fail
      expect(commandError).toBeTruthy();
      expect(commandError?.message).toContain(
        "Can't complete SOCKS5 connection"
      );
    }, 10000);
  });

  describe("Authentication Tests", () => {
    beforeAll((done) => {
      // Create and start SOCKS server with authentication
      socksServer = createServer({
        authenticate: (username, password, socket, callback) => {
          console.log(
            `Authentication attempt - username: ${username}, password: ${password}`
          );
          if (username === TEST_USERNAME && password === TEST_PASSWORD) {
            console.log("Authentication successful");
            callback();
          } else {
            console.log("Authentication failed");
            callback(new Error("Authentication failed"));
          }
        },
      });

      socksServer.listen(SOCKS_PORT, "127.0.0.1", () => {
        console.log(`SOCKS server with auth listening on port ${SOCKS_PORT}`);
      });

      // Create and start HTTP server
      httpServer = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Hello from HTTP Server!" }));
      });

      httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
        console.log(`HTTP server listening on port ${HTTP_PORT}`);
        done();
      });
    });

    afterAll((done) => {
      // Cleanup: Close both servers
      socksServer.close(() => {
        httpServer.close(() => {
          done();
        });
      });
    });

    it("should successfully proxy HTTP request with correct credentials", async () => {
      const curlCommand = `curl -v -x socks5h://${TEST_USERNAME}:${TEST_PASSWORD}@127.0.0.1:${SOCKS_PORT} http://127.0.0.1:${HTTP_PORT}`;

      try {
        const { stdout, stderr } = await execAsync(curlCommand);
        console.log("Curl success output:", stdout);
        console.log("Curl stderr output:", stderr);

        // Parse the response
        const response = JSON.parse(stdout);

        // Verify the response contains the expected message
        expect(response).toHaveProperty("message");
        expect(response.message).toBe("Hello from HTTP Server!");
      } catch (error) {
        console.error("Error executing curl command:", error);
        throw error;
      }
    }, 10000);

    it("should reject connection with incorrect credentials", async () => {
      const curlCommand = `curl -v -x socks5h://wronguser:wrongpass@127.0.0.1:${SOCKS_PORT} http://127.0.0.1:${HTTP_PORT}`;

      await expect(execAsync(curlCommand)).rejects.toThrow();
      try {
        await execAsync(curlCommand);
      } catch (error: any) {
        // Check for curl exit code 97 (CURLE_PROXY)
        expect(error.code).toBe(97);
      }
    }, 10000);

    it("should reject connection with no credentials when auth is required", async () => {
      const curlCommand = `curl -v -x socks5h://127.0.0.1:${SOCKS_PORT} http://127.0.0.1:${HTTP_PORT}`;

      await expect(execAsync(curlCommand)).rejects.toThrow();
      try {
        await execAsync(curlCommand);
      } catch (error: any) {
        // Check for curl exit code 97 (CURLE_PROXY)
        expect(error.code).toBe(97);
      }
    }, 10000);
  });
});
