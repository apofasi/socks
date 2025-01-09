/**
 * Utility class for reading binary data from a buffer
 */
export class BinaryReader {
  private buf: Buffer;
  private pos: number;

  constructor(buffer: Buffer) {
    this.buf = buffer;
    this.pos = 0;
  }

  /**
   * Read an 8-bit unsigned integer
   */
  word8(): number {
    const value = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return value;
  }

  /**
   * Read a 32-bit unsigned integer in big-endian format
   */
  word32be(): number {
    const value = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return value;
  }

  /**
   * Read a buffer of specified length
   */
  readBuffer(length: number): Buffer {
    const value = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return value;
  }

  /**
   * Get remaining buffer
   */
  remaining(): Buffer {
    return this.buf.subarray(this.pos);
  }

  /**
   * Get current position
   */
  getPosition(): number {
    return this.pos;
  }
}

/**
 * Parse SOCKS5 authentication request
 * +----+------+----------+------+----------+
 * |VER | ULEN |  UNAME   | PLEN |  PASSWD  |
 * +----+------+----------+------+----------+
 * | 1  |  1   | 1 to 255 |  1   | 1 to 255 |
 * +----+------+----------+------+----------+
 */
export function parseAuthRequest(buffer: Buffer) {
  const reader = new BinaryReader(buffer);
  const ver = reader.word8();
  const ulen = reader.word8();
  const uname = reader.readBuffer(ulen);
  const plen = reader.word8();
  const passwd = reader.readBuffer(plen);

  return {
    ver,
    ulen,
    uname,
    plen,
    passwd,
    requestBuffer: buffer,
  };
}

/**
 * Parse SOCKS5 connection request
 * +----+-----+-------+------+----------+----------+
 * |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
 * +----+-----+-------+------+----------+----------+
 * | 1  |  1  | X'00' |  1   | Variable |    2     |
 * +----+-----+-------+------+----------+----------+
 */
export function parseConnectRequest(buffer: Buffer) {
  const reader = new BinaryReader(buffer);
  const ver = reader.word8();
  const cmd = reader.word8();
  const rsv = reader.word8();
  const atyp = reader.word8();

  return {
    ver,
    cmd,
    rsv,
    atyp,
    requestBuffer: buffer,
    remaining: reader.remaining(),
  };
}

/**
 * Parse IPv4 address from buffer
 * Format: X.X.X.X (4 bytes)
 */
export function parseIPv4Address(buffer: Buffer): string {
  return Array.from(buffer).join(".");
}

/**
 * Parse IPv6 address from buffer
 * Format: 4 x 32-bit integers in big-endian
 */
export function parseIPv6Address(buffer: Buffer): string {
  const reader = new BinaryReader(buffer);
  const parts: string[] = [];

  // Read 4 x 32-bit integers
  for (let i = 0; i < 4; i++) {
    const value = reader.word32be();
    // Convert each 32-bit integer into two 16-bit hex values
    parts.push((value >>> 16).toString(16));
    parts.push((value & 0xffff).toString(16));
  }

  return parts.join(":");
}

/**
 * Parse domain name from buffer
 * Format: length (1 byte) + domain name
 */
export function parseDomainName(buffer: Buffer): {
  size: number;
  addr: string;
} {
  const reader = new BinaryReader(buffer);
  const size = reader.word8();
  const addr = reader.readBuffer(size).toString();
  return { size, addr };
}
