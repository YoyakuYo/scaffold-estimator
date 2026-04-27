import { extractFirstSectionFromText } from './sectionParser';
import {
  layerSuggestsBeam,
  layerSuggestsColumn,
  textLooksLikeBeamLabel,
  textLooksLikeBraceLabel,
  textLooksLikeColumnLabel,
} from './patterns';
import { normalizeSteelDrawingText } from './textNormalize';
import { segmentAngleDeg, segmentLength, segmentMidpoint } from './geometry';
import type {
  SteelBeamRecord,
  SteelBraceRecord,
  SteelColumnRecord,
  SteelExtractionThresholds,
  SteelGeometryLine,
  SteelTextEntity,
} from './types';

export type ClassifiedMember =
  | { kind: 'beam'; record: SteelBeamRecord }
  | { kind: 'column'; record: SteelColumnRecord }
  | { kind: 'brace'; record: SteelBraceRecord }
  | { kind: 'ignore' };

function textsNearMidpoint(
  line: SteelGeometryLine,
  texts: SteelTextEntity[],
  maxDist: number,
): SteelTextEntity[] {
  const mid = segmentMidpoint(line);
  const maxD2 = maxDist * maxDist;
  const hits: { t: SteelTextEntity; d2: number }[] = [];
  for (const t of texts) {
    const dx = t.x - mid[0];
    const dy = t.y - mid[1];
    const d2 = dx * dx + dy * dy;
    if (d2 <= maxD2) hits.push({ t, d2 });
  }
  hits.sort((a, b) => a.d2 - b.d2);
  return hits.map((h) => h.t);
}

function pickLabelAndSection(
  nearby: SteelTextEntity[],
  kind: 'beam' | 'column' | 'brace',
): { label: string | null; section: string | null } {
  let label: string | null = null;
  let section: string | null = null;

  for (const t of nearby) {
    const raw = t.content;
    const sec = extractFirstSectionFromText(raw);
    if (sec && !section) {
      section = sec.raw;
    }
  }

  for (const t of nearby) {
    const n = normalizeSteelDrawingText(t.content).trim();
    if (kind === 'beam' && textLooksLikeBeamLabel(n)) {
      label = n;
      break;
    }
    if (kind === 'column' && textLooksLikeColumnLabel(n)) {
      label = n;
      break;
    }
    if (kind === 'brace' && textLooksLikeBraceLabel(n)) {
      label = n;
      break;
    }
  }

  // Member marks G1 / C1 / BR1 without dictionary word
  if (!label) {
    for (const t of nearby) {
      const compact = normalizeSteelDrawingText(t.content).replace(/\s+/g, '');
      if (kind === 'beam' && /^(G|B)\d+$/i.test(compact)) {
        label = compact;
        break;
      }
      if (kind === 'column' && /^C\d+$/i.test(compact)) {
        label = compact;
        break;
      }
      if (kind === 'brace' && /^(BR|RB|TR)\d*$/i.test(compact)) {
        label = compact;
        break;
      }
    }
  }

  return { label, section };
}

/** Diagonal stair / 階段 — exclude from brace when labeled. */
function textLooksLikeStair(text: string): boolean {
  return /階段|stair/i.test(normalizeSteelDrawingText(text));
}

export function classifySteelLine(
  line: SteelGeometryLine,
  texts: SteelTextEntity[],
  thresholds: SteelExtractionThresholds,
): ClassifiedMember {
  const len = segmentLength(line);
  if (len < thresholds.minSegmentLength) {
    return { kind: 'ignore' };
  }

  const ang = segmentAngleDeg(line);
  const dH = Math.min(ang, 180 - ang);
  const dV = Math.abs(ang - 90);

  const isHoriz = dH <= thresholds.beamAngleDeg;
  const isVert = dV <= thresholds.columnAngleDeg;
  const isDiag = !isHoriz && !isVert && dH >= thresholds.braceMinDeviationDeg && dV >= thresholds.braceMinDeviationDeg;

  const nearby = textsNearMidpoint(line, texts, thresholds.textSnapDistance);
  const layer = line.layer;

  if (isDiag) {
    if (nearby.some((t) => textLooksLikeStair(t.content))) {
      return { kind: 'ignore' };
    }
    const { label, section } = pickLabelAndSection(nearby, 'brace');
    return {
      kind: 'brace',
      record: {
        type: 'brace',
        start: [line.x1, line.y1],
        end: [line.x2, line.y2],
        section,
        label,
        layer,
        length: len,
        angleDeg: ang,
      },
    };
  }

  if (isVert || (layer && layerSuggestsColumn(layer) && !isHoriz)) {
    const { label, section } = pickLabelAndSection(nearby, 'column');
    const useCol =
      isVert ||
      (layer && layerSuggestsColumn(layer) && (label || len > 800));
    if (!useCol) return { kind: 'ignore' };
    const mid = segmentMidpoint(line);
    return {
      kind: 'column',
      record: {
        type: 'column',
        position: mid,
        section,
        label,
        layer,
      },
    };
  }

  if (isHoriz || (layer && layerSuggestsBeam(layer))) {
    const { label, section } = pickLabelAndSection(nearby, 'beam');
    const useBeam =
      isHoriz &&
      (label != null ||
        (layer && layerSuggestsBeam(layer)) ||
        len >= Math.max(800, thresholds.minSegmentLength * 4));
    if (!useBeam) return { kind: 'ignore' };
    return {
      kind: 'beam',
      record: {
        type: 'beam',
        start: [line.x1, line.y1],
        end: [line.x2, line.y2],
        section,
        label,
        layer,
        length: len,
        angleDeg: ang,
      },
    };
  }

  return { kind: 'ignore' };
}
