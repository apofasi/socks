import * as http from "http";
import { AddressInfo } from "net";
import { createServer, SocksServerOptions } from "../src/server";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);

interface TargetServer {
  server: http.Server;
  port: number;
}

interface Socks5Server {
  server: ReturnType<typeof createServer>;
  port: number;
}

/**
 * Creates an HTTP server for testing SOCKS5 proxy connections
 * @returns Promise that resolves with the server instance and its port
 */
export async function createTargetServer(): Promise<TargetServer> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Hello from target server!");
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

/**
 * Creates a SOCKS5 server for testing
 * @param options Server configuration options
 * @returns Promise that resolves with the server instance and its port
 */
export async function createTestSocks5Server(
  options?: SocksServerOptions
): Promise<Socks5Server> {
  return new Promise((resolve) => {
    const server = createServer(options);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

/**
 * Execute a curl command through SOCKS5 proxy
 * @param url The target URL
 * @param proxies Array of proxy configurations (currently only first proxy is used)
 * @returns Promise that resolves with the response
 */
export async function curlThroughProxies(
  url: string,
  proxies: Array<{
    host: string;
    port: number;
    auth?: {
      username: string;
      password: string;
    };
  }>
): Promise<string> {
  if (!proxies.length) {
    throw new Error("At least one proxy is required");
  }

  // We only use the first proxy as subsequent proxying is handled by socketFactory
  const proxy = proxies[0];
  const auth = proxy.auth
    ? `${proxy.auth.username}:${proxy.auth.password}@`
    : "";

  const proxyUrl = `socks5h://${auth}${proxy.host}:${proxy.port}`;
  const command = `curl -s --proxy "${proxyUrl}" "${url}"`;

  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      throw new Error(`Curl error: ${stderr}`);
    }
    return stdout;
  } catch (error: any) {
    if (error?.message) {
      throw new Error(`Failed to execute curl command: ${error.message}`);
    }
    throw new Error("Failed to execute curl command: Unknown error");
  }
}
