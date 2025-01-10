import { createServer } from '../src/server';
import { URL } from 'url';
import { SocksClient } from 'socks';

// Parse command line arguments
const proxyUrl = process.argv[2];
if (!proxyUrl) {
  console.error('Please provide a target SOCKS5 URL as an argument');
  console.error('This server will forward all connections to the target SOCKS5 proxy');
  process.exit(1);
}

try {
  // Parse the target SOCKS5 URL
  const url = new URL(proxyUrl);
  
  // Extract target proxy configuration
  const targetHost = url.hostname;
  const targetPort = parseInt(url.port) || 1080;
  const targetUsername = url.username;
  const targetPassword = url.password;

  // Create server with custom socket factory
  const server = createServer({
    socketFactory: async (destinationAddress: string, destinationPort: number) => {
      console.log(`Forwarding connection to ${destinationAddress}:${destinationPort}`);
      console.log(`Via SOCKS5 proxy: ${targetHost}:${targetPort}`);

      const { socket } = await SocksClient.createConnection({
        proxy: {
          host: targetHost,
          port: targetPort,
          type: 5,
          userId: targetUsername,
          password: targetPassword,
        },
        command: 'connect',
        destination: {
          host: destinationAddress,
          port: destinationPort,
        },
      });

      console.log('Connection established through proxy');
      return socket;
    }
  });

  // Start listening on a local port
  const localPort = 1080;
  const localHost = '127.0.0.1';

  server.listen(localPort, localHost, () => {
    console.log('\nUnauthorized SOCKS5 server started');
    console.log(`Listening on: ${localHost}:${localPort}`);
    console.log(`Forwarding to: ${proxyUrl}`);
    if (targetUsername && targetPassword) {
      console.log('Using authentication for target proxy');
    }
    console.log('\nYou can now use this proxy without authentication:');
    console.log(`socks5://${localHost}:${localPort}`);
    console.log('\nPress Ctrl+C to stop the server');
  });

  // Handle process termination
  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
      console.log('Server stopped');
      process.exit(0);
    });
  });

} catch (error: any) {
  console.error('Error:', error.message);
  console.log('\nUsage: ts-node examples/server-example.ts <target-socks5-url>');
  console.log('Examples:');
  console.log('  ts-node examples/server-example.ts socks5://proxy.example.com:1080');
  console.log('  ts-node examples/server-example.ts socks5://user:pass@proxy.example.com:1080');
  process.exit(1);
} 