import { createServer } from "../src/server";
import { SocksClient } from "socks";
import { Duplex } from "stream";
import { URL } from "url";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);

interface ProxyConfig {
  host: string;
  port: number;
  auth?: {
    username: string;
    password: string;
  };
}

/**
 * Parse SOCKS5 proxy URL into config
 * Supports formats:
 * - socks5://host:port
 * - socks5://username:password@host:port
 */
function parseProxyUrl(proxyUrl: string): ProxyConfig {
  const url = new URL(proxyUrl);
  if (!url.hostname || !url.port) {
    throw new Error("Invalid proxy URL: must include host and port");
  }

  const config: ProxyConfig = {
    host: url.hostname,
    port: parseInt(url.port, 10),
  };

  if (url.username && url.password) {
    config.auth = {
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  }

  return config;
}

/**
 * Create a local proxy tunnel to a remote SOCKS5 proxy
 */
async function createProxyTunnel(remoteProxyUrl: string, targetUrl: string) {
  // Parse remote proxy config
  const remoteProxy = parseProxyUrl(remoteProxyUrl);
  console.log("Remote proxy:", {
    host: remoteProxy.host,
    port: remoteProxy.port,
    auth: remoteProxy.auth ? "configured" : "none",
  });

  // Create local proxy that forwards to remote proxy
  const localProxy = createServer({
    socketFactory: async (
      destinationAddress: string,
      destinationPort: number
    ): Promise<Duplex> => {
      // Connect to the destination through the remote proxy
      const { socket } = await SocksClient.createConnection({
        proxy: {
          host: remoteProxy.host,
          port: remoteProxy.port,
          type: 5,
          userId: remoteProxy.auth?.username,
          password: remoteProxy.auth?.password,
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

  // Start local proxy on random port
  await new Promise<void>((resolve) => {
    localProxy.listen(0, "127.0.0.1", resolve);
  });

  const address = localProxy.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get local proxy address");
  }

  console.log("Local proxy running on:", {
    host: "127.0.0.1",
    port: address.port,
  });

  try {
    // Execute curl through the local proxy
    const command = `curl -s --proxy "socks5h://127.0.0.1:${address.port}" "${targetUrl}"`;
    console.log("\nExecuting request...");

    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      console.error("Curl error:", stderr);
      return;
    }

    console.log("\nResponse from", targetUrl + ":");
    console.log(stdout);
  } finally {
    // Cleanup
    localProxy.close();
  }
}

// Check command line arguments
if (process.argv.length !== 4) {
  console.log("Usage: ts-node proxy-tunnel.ts <target-url> <proxy-url>");
  console.log(
    "Example: ts-node proxy-tunnel.ts http://example.com socks5://user:pass@proxy.example.com:1080"
  );
  process.exit(1);
}

// Run the tunnel
const [, , targetUrl, proxyUrl] = process.argv;
createProxyTunnel(proxyUrl, targetUrl).catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
