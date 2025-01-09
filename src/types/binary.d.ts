import { Stream } from "stream";

declare module "binary" {
  interface BinaryStream extends Stream {
    word8(key: string): this;
    word16bu(key: string): this;
    word32be(key: string): this;
    buffer(key: string, length: string | number): this;
    tap(callback: (args: any) => void): this;
  }

  interface Binary {
    stream(buffer: Buffer): BinaryStream;
  }

  const binary: Binary;
  export default binary;
}
