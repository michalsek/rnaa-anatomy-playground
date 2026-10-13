// Type declarations for dl-wire.mjs (the TypeScript page host imports the module directly).

export declare const DL_WIRE_ENCODING: string;
export declare function packDlBinary(binary: ArrayBuffer | ArrayBufferView): Uint8Array;
export declare function unpackDlBinary(packed: ArrayBuffer | ArrayBufferView): ArrayBuffer;
export declare function decodeDlWire(base64: string): Promise<ArrayBuffer>;
