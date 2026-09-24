import { describe, expect, it } from "vitest";
import {
  brushCells,
  stamp,
  decodePixels,
  encodePixels,
  floodFill,
  fromHex,
  getPixel,
  line,
  paletteOf,
  setPixel,
  shade,
  toHex,
  TRANSPARENT,
  type Pixels,
  type Rgba,
} from "../lib/pixels";

const RED: Rgba = [200, 30, 40, 255];
const BLUE: Rgba = [20, 60, 220, 255];

function blank(width: number, height: number, color: Rgba = TRANSPARENT): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(color, i * 4);
  return { width, height, data };
}

describe("éditeur de pixels", () => {
  it("fait l'aller-retour avec le backend (RVBA en base64)", () => {
    const pixels = blank(4, 2, BLUE);
    setPixel(pixels, 3, 1, RED);
    const back = decodePixels(encodePixels(pixels));
    expect(back.width).toBe(4);
    expect(getPixel(back, 3, 1)).toEqual(RED);
    expect(getPixel(back, 0, 0)).toEqual(BLUE);
    // Grande texture d'interface : pas de débordement de pile.
    expect(decodePixels(encodePixels(blank(256, 256, RED))).data.length).toBe(256 * 256 * 4);
  });

  it("peint, remplit une zone et trace des traits continus", () => {
    const pixels = blank(8, 8);
    expect(setPixel(pixels, 1, 1, RED)).toBe(true);
    expect(setPixel(pixels, 1, 1, RED)).toBe(false);
    expect(setPixel(pixels, 9, 1, RED)).toBe(false);
    // Mur vertical en x = 4 : le remplissage s'arrête dessus.
    for (let y = 0; y < 8; y += 1) setPixel(pixels, 4, y, BLUE);
    const filled = floodFill(pixels, 0, 0, RED);
    expect(filled).toBe(4 * 8 - 1);
    expect(getPixel(pixels, 5, 0)).toEqual(TRANSPARENT);
    expect(floodFill(pixels, 0, 0, RED)).toBe(0);

    const points = line(0, 0, 5, 2);
    expect(points[0]).toEqual([0, 0]);
    expect(points.at(-1)).toEqual([5, 2]);
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBe(1);
    }
  });

  it("propose la palette de la texture et règle les couleurs", () => {
    const pixels = blank(4, 4, BLUE);
    setPixel(pixels, 0, 0, RED);
    setPixel(pixels, 1, 0, TRANSPARENT);
    expect(paletteOf(pixels)).toEqual([BLUE, RED]);
    expect(toHex(RED)).toBe("#c81e28");
    expect(fromHex("#c81e28")).toEqual(RED);
    expect(fromHex("fff")).toEqual([255, 255, 255, 255]);
    expect(fromHex("#12")).toBeNull();
    expect(shade([100, 100, 100, 255], -0.5)).toEqual([50, 50, 50, 255]);
    expect(shade([100, 100, 100, 255], 0.5)[0]).toBe(178);
  });
});

describe("pinceau", () => {
  it("couvre un carré jusqu'à 3 pixels, un disque au-delà", () => {
    expect(brushCells(5, 5, 1)).toEqual([[5, 5]]);
    expect(brushCells(5, 5, 2)).toHaveLength(4);
    expect(brushCells(5, 5, 3)).toHaveLength(9);
    const round = brushCells(5, 5, 4);
    expect(round).toHaveLength(12);
    expect(round).not.toContainEqual([4, 4]);
    expect(round).toContainEqual([5, 5]);
  });

  it("gomme une zone d'un seul geste, sans sortir de l'image", () => {
    const image = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };
    expect(stamp(image, 0, 0, 3, [0, 0, 0, 0])).toBe(true);
    const cleared = [...Array(16).keys()].filter((i) => image.data[i * 4 + 3] === 0).length;
    expect(cleared).toBe(4);
    expect(stamp(image, 0, 0, 3, [0, 0, 0, 0])).toBe(false);
  });
});
