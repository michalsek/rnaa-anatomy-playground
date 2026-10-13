export declare const EPS: number;
export declare function samePoint(p: number[], q: number[]): boolean;
export declare function withoutRepeats(points: number[][]): number[][];
export declare function cleanRing(points: number[][]): number[][];
export declare function signedArea(ring: number[][]): number;
export declare function isSimpleRing(ring: number[][]): boolean;
export declare function triangulate(subpaths: { points: number[][] }[]): { positions: number[][]; indices: number[]; method: "earcut" | "libtess" | "empty"; rings: number[][][]; simpleRings: boolean[] };
