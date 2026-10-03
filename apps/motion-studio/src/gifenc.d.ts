declare module 'gifenc' {
  interface FrameOptions {
    palette?: number[][];
    delay?: number;
    repeat?: number;
    dispose?: number;
  }
  interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytesView(): Uint8Array;
  }
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): Encoder;
}
