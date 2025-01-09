# @apofasi/socks

A modern SOCKS5 server implementation with TypeScript support. This package is a modernized TypeScript fork of [simple-socks](https://github.com/brozeph/simple-socks), providing enhanced type safety and modern JavaScript features.

## Credits

This project is based on [simple-socks](https://github.com/brozeph/simple-socks) by [brozeph](https://github.com/brozeph). We've made the following improvements:
- Full TypeScript rewrite with complete type definitions
- Modern JavaScript features and best practices
- Enhanced error handling and type safety
- Improved documentation and examples
- Zero production dependencies

## Features

- Full SOCKS5 protocol support (RFC 1928)
- Username/password authentication (RFC 1929)
- TypeScript support with complete type definitions
- Support for IPv4, IPv6, and domain name resolution
- Customizable socket factory for connection handling
- Connection filtering capabilities
- Event-based architecture
- Zero production dependencies

## Installation

```bash
npm install @apofasi/socks
```

## Basic Usage

### Creating a Simple SOCKS5 Server

```typescript
import { createServer } from '@apofasi/socks';

// Create a server without authentication
const server = createServer();

// Start listening
server.listen(1080, '127.0.0.1', () => {
  console.log('SOCKS5 server listening on 127.0.0.1:1080');
});
```

### Creating a Server with Authentication

```typescript
import { createServer } from '@apofasi/socks';

// Create a server with authentication
const server = createServer({
  authenticate: (username, password, socket, callback) => {
    if (username === 'user' && password === 'pass') {
      callback(); // Authentication successful
    } else {
      callback(new Error('Authentication failed'));
    }
  }
});

server.listen(1080, '127.0.0.1', () => {
  console.log('SOCKS5 server with authentication listening on 127.0.0.1:1080');
});
```

### Custom Socket Factory

```typescript
import { createServer } from '@apofasi/socks';
import { SocksClient } from 'socks';

// Create a server that chains to another SOCKS5 proxy
const server = createServer({
  socketFactory: async (destinationAddress, destinationPort) => {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: 'next-proxy.example.com',
        port: 1080,
        type: 5,
      },
      command: 'connect',
      destination: {
        host: destinationAddress,
        port: destinationPort,
      },
    });
    return socket;
  }
});

server.listen(1080);
```

## API Reference

### createServer(options?)

Creates a new SOCKS5 server instance.

#### Options

- `authenticate?: (username: string, password: string, socket: Socket, callback: (err?: Error) => void) => void`
  - Optional authentication handler
  - Called when a client attempts to authenticate
  - Call callback() for success, callback(error) for failure

- `socketFactory?: (address: string, port: number) => Promise<Duplex>`
  - Optional custom socket factory
  - Called when establishing connections to destinations
  - Useful for chaining proxies or custom connection handling

- `connectionFilter?: (destination: { address: string, port: number }, origin: { address: string, port: number }, callback: (err?: Error) => void) => void`
  - Optional connection filter
  - Called before establishing connections
  - Can be used to implement access control

### Server Events

- `authenticate` - Emitted on successful authentication
- `authenticateError` - Emitted on authentication failure
- `connectionFilter` - Emitted when connection filtering occurs
- `proxyConnect` - Emitted when a proxy connection is established
- `proxyData` - Emitted when data is transferred
- `proxyError` - Emitted on proxy errors
- `proxyEnd` - Emitted when a proxy connection ends

## Testing

```bash
npm test
```

## Contributing

This project is a fork of [simple-socks](https://github.com/brozeph/simple-socks) and follows its core design principles while adding modern TypeScript support. Contributions are welcome! Here's how you can contribute:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run the tests (`npm test`)
5. Commit your changes (`git commit -m 'feat: add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Scripts

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build the package
npm run build

# Lint code
npm run lint

# Format code
npm run format

# Publish new versions
npm run publish-patch  # For bug fixes (1.1.0 -> 1.1.1)
npm run publish-minor  # For new features (1.1.0 -> 1.2.0)
npm run publish-major  # For breaking changes (1.1.0 -> 2.0.0)
```

## License

MIT

## Acknowledgments

- [simple-socks](https://github.com/brozeph/simple-socks) - The original project this is forked from
- [RFC 1928](https://www.ietf.org/rfc/rfc1928.txt) - SOCKS Protocol Version 5
- [RFC 1929](https://www.ietf.org/rfc/rfc1929.txt) - Username/Password Authentication for SOCKS V5
