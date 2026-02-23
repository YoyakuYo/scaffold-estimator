/**
 * DXF Parser — Client-side DXF text parsing
 *
 * Uses the `dxf-parser` npm package to parse DXF text content
 * and return a structured representation.
 *
 * Pure function. No UI, no side-effects.
 */

import DxfParser from 'dxf-parser';
import type { IDxf } from 'dxf-parser';

export type { IDxf };

/**
 * Parse a DXF string into a structured IDxf object.
 *
 * @param dxfText - Raw DXF file content as a string
 * @returns Parsed DXF data, or null on failure
 * @throws Error with descriptive message on parse failure
 */
export function parseDxf(dxfText: string): IDxf {
  const parser = new DxfParser();

  const result = parser.parseSync(dxfText);
  if (!result) {
    throw new Error('DXF parsing returned null — file may be corrupt or empty.');
  }

  return result;
}

/**
 * Read a File object as text and parse it as DXF.
 *
 * @param file - Browser File object (from input or drop)
 * @returns Parsed DXF data
 */
export async function parseDxfFile(file: File): Promise<IDxf> {
  const text = await file.text();
  return parseDxf(text);
}
