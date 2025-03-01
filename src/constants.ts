export const RFC_1928_ATYP = {
  DOMAINNAME: 0x03,
  IPV4: 0x01,
  IPV6: 0x04,
} as const;

export const RFC_1928_COMMANDS = {
  BIND: 0x02,
  CONNECT: 0x01,
  UDP_ASSOCIATE: 0x03,
} as const;

export const RFC_1928_METHODS = {
  BASIC_AUTHENTICATION: 0x02,
  GSSAPI: 0x01,
  NO_ACCEPTABLE_METHODS: 0xff,
  NO_AUTHENTICATION_REQUIRED: 0x00,
} as const;

export const RFC_1928_REPLIES = {
  ADDRESS_TYPE_NOT_SUPPORTED: 0x08,
  COMMAND_NOT_SUPPORTED: 0x07,
  CONNECTION_NOT_ALLOWED: 0x02,
  CONNECTION_REFUSED: 0x05,
  GENERAL_FAILURE: 0x01,
  HOST_UNREACHABLE: 0x04,
  NETWORK_UNREACHABLE: 0x03,
  SUCCEEDED: 0x00,
  TTL_EXPIRED: 0x06,
} as const;

export const RFC_1928_VERSION = 0x05;

export const RFC_1929_REPLIES = {
  GENERAL_FAILURE: 0xff,
  SUCCEEDED: 0x00,
} as const;

export const RFC_1929_VERSION = 0x01;

// Type definitions
export type RFC1928Atyp = typeof RFC_1928_ATYP;
export type RFC1928Commands = typeof RFC_1928_COMMANDS;
export type RFC1928Methods = typeof RFC_1928_METHODS;
export type RFC1928Replies = typeof RFC_1928_REPLIES;
export type RFC1929Replies = typeof RFC_1929_REPLIES;
