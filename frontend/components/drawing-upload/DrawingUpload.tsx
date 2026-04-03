'use client';

import React, {
  useState, useRef, useCallback, useEffect, useMemo,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { PerimeterModel } from '@/lib/perimeter-model';
import { parseDxfFile } from '@/cad/parseDxf';
import { extractSegments } from '@/cad/extractSegments';
import { detectOuterPolygon } from '@/geometry/polygonDetection';
import { drawingsApi, type CadWallSegment } from '@/lib/api/drawings';
import {
  Upload, Loader2, AlertCircle, FileUp, RotateCcw, Check,
  Pencil, Trash2, Building2, Ruler, MousePointer2,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { type TranslationKeys } from '@/lib/i18n/translations';
import {
  SCAFFOLD_WALL_CF_KEYS,
  normalizeScaffoldWallCfKey,
  type ScaffoldWallCfKey,
} from '@/lib/scaffold-wall-cf-options';
import { EdgeHashiraPlanningPanel } from '@/components/edge-hashira-planning-panel';
import type { EdgeHashiraFormRow } from '@/lib/edge-hashira-labels';

const SCAFFOLD_WALL_CF_LABEL_KEYS = {
  '': 'wallCfUnspecified',
  std: 'wallCfStd',
  pattanko: 'wallCfPattanko',
  opening: 'wallCfOpening',
  stair: 'wallCfStair',
  other: 'wallCfOther',
} as const satisfies Record<ScaffoldWallCfKey, keyof TranslationKeys['scaffoldExtra']>;

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface DrawingUploadProps {
  perimeterModel: PerimeterModel;
  onWallsDetected: (
    walls: Array<{ side: string; lengthMm: number }>,
    vertices?: Array<{ x: number; y: number }>,
  ) => void;
  onSegmentEdit: (index: number, lengthMm: number) => void;
  externalWallLengths: number[];
  buildingHeightMm: number | null;
  onBuildingHeightChange: (mm: number | null) => void;
  /** Overrides the default label (e.g. default height for new edges, not a single building height). */
  buildingHeightLabel?: string;
  /** Short hint under the height field */
  buildingHeightHint?: string;
  /** Per-edge scaffold height (mm), same order as walls — editable as meters in the side panel. */
  wallHeightsMm?: number[];
  onWallHeightMmChange?: (edgeIndex: number, mm: number) => void;
  /** Per-edge CF dropdown value (see scaffold-wall-cf-options); stored on wall as cfNote. */
  wallCfNotes?: string[];
  onWallCfNoteChange?: (edgeIndex: number, value: ScaffoldWallCfKey) => void;
  /** Plan run: choose X or Y then signed run length (mm) — same order as walls. */
  edgePlanAxes?: Array<'X' | 'Y'>;
  edgePlanAxisMm?: number[];
  onEdgePlanAxisChange?: (edgeIndex: number, axis: 'X' | 'Y') => void;
  onEdgePlanAxisMmChange?: (edgeIndex: number, mm: number) => void;
  /** Per-wall X/Y + optional post count for plan labels (same order as walls / externalWallLengths). */
  edgeHashiraRows?: EdgeHashiraFormRow[];
  onEdgeHashiraRowChange?: (wallIndex: number, patch: Partial<EdgeHashiraFormRow>) => void;
  /**
   * When false, image/PDF skips Vision/AI API (Premium-only); DXF still uses client parser.
   * Default true.
   */
  allowAiPoweredFileParsing?: boolean;
}

interface Vertex { x: number; y: number }
interface Seg { start: Vertex; end: Vertex }

type Phase = 'idle' | 'processing' | 'editor' | 'error';
type FileKind = 'dxf' | 'cad' | 'pdf' | 'image';

interface ShapeState {
  verts: Vertex[];
  wallMm: number[];
  coordsAreMm: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function fileKind(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'dxf') return 'dxf';
  if (ext === 'dwg' || ext === 'jww') return 'cad'; // legacy: backend rejects these with a clear message
  if (ext === 'pdf') return 'pdf';
  return 'image';
}

function d(a: Vertex, b: Vertex): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Minimum geometric edge length (mm) before we trust DXF/mm trace without a manual dimension prompt. */
const TRACE_MIN_TRUST_MM = 600;

function fmtMeters(mm: number): string {
  if (mm <= 0) return '?';
  const m = mm / 1000;
  return `${m.toFixed(m >= 10 ? 2 : 2)}m`;
}

function parseMetersInputToMm(s: string): number | null {
  const v = parseFloat(String(s).trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 1000);
}

function parseSignedMetersToMm(s: string): number | null {
  const t = String(s).trim().replace(',', '.');
  if (t === '' || t === '-' || t === '+') return null;
  const v = parseFloat(t);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 1000);
}

function midPt(a: Vertex, b: Vertex): Vertex {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Replace {{key}} placeholders in i18n template strings */
function fillI18nTemplate(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
  }
  return out;
}

function edgeNorm(a: Vertex, b: Vertex, off: number): Vertex {
  const len = d(a, b);
  if (len < 1e-6) return { x: 0, y: -off };
  return { x: -(b.y - a.y) / len * off, y: (b.x - a.x) / len * off };
}

function bbox(pts: Vertex[], extra?: Seg[]): { x: number; y: number; w: number; h: number } {
  const all: Vertex[] = [...pts];
  if (extra) for (const s of extra) { all.push(s.start, s.end); }
  if (all.length === 0) return { x: 0, y: 0, w: 100, h: 100 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of all) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const w = x1 - x0 || 100;
  const h = y1 - y0 || 100;
  const pad = Math.max(w, h) * 0.12;
  return { x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad };
}

function svgPt(e: React.MouseEvent, svg: SVGSVGElement): Vertex | null {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const s = pt.matrixTransform(ctm.inverse());
  return { x: s.x, y: s.y };
}

function recalcLengths(verts: Vertex[]): number[] {
  return verts.map((v, i) => Math.round(d(v, verts[(i + 1) % verts.length])));
}

const ACCEPT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/bmp': ['.bmp'],
  'application/pdf': ['.pdf'],
  'application/dxf': ['.dxf'],
  'image/vnd.dxf': ['.dxf'],
  'application/octet-stream': ['.dxf'],
};

const FILE_LABELS = ['PDF', 'DXF', 'JPG', 'PNG'];

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

export function DrawingUpload({
  perimeterModel,
  onWallsDetected,
  onSegmentEdit,
  externalWallLengths,
  buildingHeightMm,
  onBuildingHeightChange,
  buildingHeightLabel,
  buildingHeightHint,
  wallHeightsMm = [],
  onWallHeightMmChange,
  wallCfNotes = [],
  onWallCfNoteChange,
  edgePlanAxes = [],
  edgePlanAxisMm = [],
  onEdgePlanAxisChange,
  onEdgePlanAxisMmChange,
  edgeHashiraRows = [],
  onEdgeHashiraRowChange,
  allowAiPoweredFileParsing = true,
}: DrawingUploadProps) {
  const { t } = useI18n();
  const mUnit = t('common', 'metersShort') || 'm';
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<FileKind>('image');
  const [status, setStatus] = useState('');
  const [errMsg, setErrMsg] = useState('');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [bgSegs, setBgSegs] = useState<Seg[]>([]);

  const [shape, setShape] = useState<ShapeState>({ verts: [], wallMm: [], coordsAreMm: false });

  const [tracing, setTracing] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const skipExtSync = useRef(false);

  // ── Cleanup ──
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  // ── Sync shape → parent ──
  useEffect(() => {
    const { verts, wallMm } = shape;
    if (verts.length < 3 || wallMm.length < 3) return;

    skipExtSync.current = true;
    const walls = wallMm.map((mm, i) => ({ side: `edge-${i}`, lengthMm: mm }));
    onWallsDetected(walls, verts);

    perimeterModel.loadFromPoints(verts);
    for (let i = 0; i < wallMm.length && i < perimeterModel.segmentCount; i++) {
      if (wallMm[i] > 0) {
        try { perimeterModel.updateSegmentLength(i, wallMm[i]); } catch { /* ignore */ }
      }
    }
  }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync externalWallLengths → shape (when edited externally) ──
  useEffect(() => {
    if (skipExtSync.current) { skipExtSync.current = false; return; }
    if (externalWallLengths.length !== shape.wallMm.length) return;
    const differs = externalWallLengths.some((v, i) => v !== shape.wallMm[i]);
    if (!differs) return;
    setShape(prev => ({ ...prev, wallMm: [...externalWallLengths] }));
  }, [externalWallLengths]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shape mutators ──

  const moveVertex = useCallback((idx: number, pos: Vertex) => {
    setShape(prev => {
      const verts = [...prev.verts];
      verts[idx] = pos;
      const wallMm = prev.coordsAreMm ? recalcLengths(verts) : [...prev.wallMm];
      return { ...prev, verts, wallMm };
    });
  }, []);

  const addVertexOnEdge = useCallback((edgeIdx: number) => {
    setShape(prev => {
      const n = prev.verts.length;
      const a = prev.verts[edgeIdx];
      const b = prev.verts[(edgeIdx + 1) % n];
      const mid = midPt(a, b);
      const verts = [...prev.verts];
      verts.splice(edgeIdx + 1, 0, mid);
      const halfLen = Math.round((prev.wallMm[edgeIdx] || 0) / 2);
      const wallMm = [...prev.wallMm];
      wallMm.splice(edgeIdx, 1, halfLen, halfLen);
      return { ...prev, verts, wallMm };
    });
  }, []);

  const deleteVertex = useCallback((idx: number) => {
    setShape(prev => {
      if (prev.verts.length <= 3) return prev;
      const n = prev.verts.length;
      const prevI = (idx - 1 + n) % n;
      const nextI = (idx + 1) % n;
      const verts = prev.verts.filter((_, j) => j !== idx);
      const mergedLen = prev.coordsAreMm
        ? Math.round(d(prev.verts[prevI], prev.verts[nextI]))
        : prev.wallMm[prevI] + prev.wallMm[idx];
      const wallMm = [...prev.wallMm];
      wallMm[prevI < idx ? prevI : prevI - 1] = mergedLen;
      const filtered = wallMm.filter((_, j) => j !== idx);
      return { ...prev, verts, wallMm: filtered };
    });
  }, []);

  const editWallLength = useCallback((idx: number, mm: number) => {
    setShape(prev => {
      const wallMm = [...prev.wallMm];
      wallMm[idx] = mm;
      return { ...prev, wallMm };
    });
    onSegmentEdit(idx, mm);
  }, [onSegmentEdit]);

  // After adding a vertex, prompt for dimension input on the new edge
  const [pendingDimIdx, setPendingDimIdx] = useState<number | null>(null);
  const [pendingDimVal, setPendingDimVal] = useState('');

  const addTraceVertex = useCallback((pos: Vertex) => {
    setShape(prev => {
      const verts = [...prev.verts, pos];
      const wallMm = [...prev.wallMm];
      let geoLen = 0;
      if (prev.verts.length > 0 && prev.coordsAreMm) {
        geoLen = Math.round(d(prev.verts[prev.verts.length - 1], pos));
        wallMm.push(geoLen);
      } else if (prev.verts.length > 0) {
        wallMm.push(0);
      } else {
        wallMm.push(0);
      }
      if (prev.verts.length >= 1) {
        const newIdx = wallMm.length - 1;
        const needManualDim = !prev.coordsAreMm || geoLen < TRACE_MIN_TRUST_MM;
        setTimeout(() => {
          if (needManualDim) {
            setPendingDimIdx(newIdx);
            setPendingDimVal('');
          } else {
            setPendingDimIdx(null);
            setPendingDimVal('');
          }
        }, 50);
      }
      return { ...prev, verts, wallMm };
    });
  }, []);

  const applyPendingDim = useCallback(() => {
    if (pendingDimIdx === null) return;
    const mm = parseMetersInputToMm(pendingDimVal);
    if (mm != null && mm > 0) {
      editWallLength(pendingDimIdx, mm);
    }
    setPendingDimIdx(null);
    setPendingDimVal('');
  }, [pendingDimIdx, pendingDimVal, editWallLength]);

  const skipPendingDim = useCallback(() => {
    setPendingDimIdx(null);
    setPendingDimVal('');
  }, []);

  // ── Process DXF client-side ──
  const processDxf = useCallback(async (f: File) => {
    try {
      setStatus(t('scaffoldExtra', 'dxfParsing') || 'Parsing DXF file...');
      const dxf = await parseDxfFile(f);
      const extraction = extractSegments(dxf);

      const segs: Seg[] = extraction.segments.map(s => ({
        start: { x: s.start.x, y: -s.start.y },
        end: { x: s.end.x, y: -s.end.y },
      }));
      setBgSegs(segs);

      const poly = detectOuterPolygon(extraction.segments);
      if (poly && poly.points.length >= 3) {
        const pts = poly.points.map(p => ({ x: p.x, y: -p.y }));
        setShape({ verts: pts, wallMm: recalcLengths(pts), coordsAreMm: true });
        setStatus(fillI18nTemplate(t('scaffoldExtra', 'shapeDetectedTpl'), { count: pts.length }));
      } else {
        setShape({ verts: [], wallMm: [], coordsAreMm: true });
        setStatus(t('scaffoldExtra', 'shapeAutoDetectFailedClickVertices') || 'Could not auto-detect building shape. Click to place vertices.');
        setTracing(true);
      }

      try { await drawingsApi.upload(f, 'default-project'); } catch { /* non-critical */ }
      setPhase('editor');
    } catch (err: any) {
      setErrMsg(`${t('scaffoldExtra', 'dxfParsingError') || 'DXF parsing error'}: ${err.message}`);
      setPhase('error');
    }
  }, [t]);

  // ── Process via AI vision API (image/PDF) — auto-extract shape and dimensions (Premium) ──
  const processBackend = useCallback(async (f: File, fk: FileKind) => {
    try {
      setStatus(t('scaffoldExtra', 'analyzingFileAutoDetecting') || 'Analyzing file and auto-detecting building shape and dimensions...');

      if (allowAiPoweredFileParsing) {
        const { visionBimApi } = await import('@/lib/api/vision-bim');
        try {
          const result = await visionBimApi.extractDimensions(f);

          if (result.vertices && result.vertices.length >= 3) {
            const verts = result.vertices as Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>;
            const hasMm = verts.some(v => (v.x ?? 0) > 100 || (v.y ?? 0) > 100);
            const pts: Vertex[] = verts.map(v => ({
              x: v.x ?? v.xFrac ?? 0,
              y: v.y ?? v.yFrac ?? 0,
            }));

            const wallMm = result.wallLengthsMm && result.wallLengthsMm.length === pts.length
              ? result.wallLengthsMm
              : recalcLengths(pts);

            setShape({ verts: pts, wallMm, coordsAreMm: hasMm });

            if (result.buildingHeightMm && result.buildingHeightMm >= 1000) {
              onBuildingHeightChange(result.buildingHeightMm);
            }

            const shapeType = pts.length === 4
              ? (t('scaffoldExtra', 'shapeRectangle') || 'Rectangle')
              : pts.length === 6
                ? (t('scaffoldExtra', 'shapeLType') || 'L-shape')
                : pts.length === 8
                  ? (t('scaffoldExtra', 'shapeZUTType') || 'Z/U/T shape')
                  : `${pts.length}${t('scaffoldExtra', 'shapePolygonSuffix') || '-gon'}`;
            setStatus(fillI18nTemplate(t('scaffoldExtra', 'shapeDetectedEditableTpl'), { shape: shapeType, count: pts.length }));
            setPhase('editor');
            return;
          }
        } catch (visionErr: any) {
          console.warn('Vision API extraction failed, falling back to basic upload:', visionErr?.message);
        }
      }

      // Fallback: basic backend upload for OCR
      try {
        const res = await drawingsApi.upload(f, 'default-project');

        if (res.status === 'failed') {
          setErrMsg(res.message || (t('scaffoldExtra', 'processingFailed') || 'Processing failed'));
          setPhase('error');
          return;
        }

        if (res.cadData?.wallSegments && res.cadData.wallSegments.length >= 3) {
          const ws = res.cadData.wallSegments;
          const pts = ws.map((s: CadWallSegment) => ({ x: s.start.x, y: -s.start.y }));
          setShape({ verts: pts, wallMm: ws.map((s: CadWallSegment) => Math.round(s.length)), coordsAreMm: true });
          if (res.cadData.buildingHeight) onBuildingHeightChange(res.cadData.buildingHeight);
          setStatus(fillI18nTemplate(t('scaffoldExtra', 'shapeDetectedCadTpl'), { count: ws.length }));
          setPhase('editor');
          return;
        }

        if (res.extractedDimensions) {
          const ed = res.extractedDimensions;
          const n = ed.walls.north?.lengthMm || 0;
          const e = ed.walls.east?.lengthMm || 0;
          const s = ed.walls.south?.lengthMm || n;
          const w = ed.walls.west?.lengthMm || e;

          if (n > 0 && e > 0) {
            const pts: Vertex[] = [
              { x: 0, y: 0 }, { x: n, y: 0 },
              { x: n, y: e }, { x: 0, y: e },
            ];
            setShape({ verts: pts, wallMm: [n, e, s, w], coordsAreMm: true });
            setStatus(t('scaffoldExtra', 'wallDimensionsDetectedEditable') || 'Wall dimensions detected. Click to edit.');
          } else {
            setShape({ verts: [], wallMm: [], coordsAreMm: false });
            setStatus(t('scaffoldExtra', 'dimensionsAutoDetectFailedClickAndInput') || 'Could not auto-detect dimensions. Click vertices and enter dimensions.');
            setTracing(true);
          }

          const height = ed.buildingHeightMm || ed.estimatedBuildingHeightMm;
          if (height && height > 0) onBuildingHeightChange(height);
        } else {
          setShape({ verts: [], wallMm: [], coordsAreMm: false });
          setStatus(t('scaffoldExtra', 'autoDetectFailedClickVertices') || 'Auto-detection failed. Click to place vertices.');
          setTracing(true);
        }
      } catch {
        setShape({ verts: [], wallMm: [], coordsAreMm: false });
        setStatus(t('scaffoldExtra', 'autoDetectFailedClickVertices') || 'Auto-detection failed. Click to place vertices.');
        setTracing(true);
      }

      setPhase('editor');
    } catch (err: any) {
      setErrMsg(`${t('viewer', 'processingError') || 'Processing error'}: ${err.message}`);
      setPhase('error');
    }
  }, [allowAiPoweredFileParsing, onBuildingHeightChange, t]);

  // ── Dropzone ──
  const onDrop = useCallback(async (accepted: File[]) => {
    if (!accepted.length) return;
    const f = accepted[0];
    const fk = fileKind(f.name);

    setFile(f);
    setKind(fk);
    setPhase('processing');
    setErrMsg('');
    setShape({ verts: [], wallMm: [], coordsAreMm: false });
    setBgSegs([]);
    setTracing(false);

    if (fk === 'image') setPreviewUrl(URL.createObjectURL(f));
    else setPreviewUrl(null);

    if (fk === 'dxf') await processDxf(f);
    else await processBackend(f, fk);
  }, [processDxf, processBackend]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: ACCEPT, maxFiles: 1, maxSize: 50 * 1024 * 1024,
  });

  // ── Reset ──
  const reset = useCallback(() => {
    setPhase('idle');
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setImgSize(null);
    setBgSegs([]);
    setShape({ verts: [], wallMm: [], coordsAreMm: false });
    setErrMsg('');
    setTracing(false);
    setDragIdx(null);
    perimeterModel.clear();
  }, [previewUrl, perimeterModel]);

  // ── Image load ──
  const onImgLoad = useCallback(() => {
    if (imgRef.current) {
      setImgSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  }, []);

  // ── ViewBox ──
  const vb = useMemo(() => {
    if (previewUrl && imgSize) return { x: 0, y: 0, w: imgSize.w, h: imgSize.h };
    return bbox(shape.verts, bgSegs.length > 0 ? bgSegs : undefined);
  }, [shape.verts, bgSegs, previewUrl, imgSize]);

  const scale = vb.w / 500;
  const vtxR = Math.max(4, scale * 4);
  const fs = Math.max(10, scale * 10);
  const sw = Math.max(1, scale * 1.5);
  const dimOff = Math.max(12, scale * 12);

  const perimeter = useMemo(() => shape.wallMm.reduce((s, v) => s + v, 0), [shape.wallMm]);

  // ── SVG interaction: vertex drag ──
  const onVtxDown = useCallback((e: React.MouseEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragIdx(i);
  }, []);

  const onSvgMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (dragIdx === null || !svgRef.current) return;
    const c = svgPt(e, svgRef.current);
    if (c) moveVertex(dragIdx, c);
  }, [dragIdx, moveVertex]);

  const onSvgUp = useCallback(() => { setDragIdx(null); }, []);

  // ── SVG interaction: trace click ──
  const onSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!tracing || dragIdx !== null || !svgRef.current) return;
    const c = svgPt(e, svgRef.current);
    if (c) addTraceVertex(c);
  }, [tracing, dragIdx, addTraceVertex]);

  // ── Close polygon in trace mode ──
  const closeTrace = useCallback(() => {
    if (shape.verts.length < 3) return;
    setTracing(false);
    if (shape.coordsAreMm) {
      setShape(prev => ({ ...prev, wallMm: recalcLengths(prev.verts) }));
    }
    setStatus(fillI18nTemplate(t('scaffoldExtra', 'shapeConfirmedTpl'), { count: shape.verts.length }));
  }, [shape.verts.length, shape.coordsAreMm, t]);

  // ── Wall edit ──
  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════

  // Phase: Idle
  if (phase === 'idle') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Upload className="h-5 w-5 text-blue-600" />
            {t('scaffoldExtra', 'drawingUpload') || '図面アップロード'}
          </h2>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
              isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50'
            }`}
          >
            <input {...getInputProps()} />
            <FileUp className={`h-12 w-12 mx-auto mb-4 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`} />
            <p className="text-base font-medium text-gray-700 mb-2">
              {isDragActive
                ? (t('scaffoldExtra', 'dropToUpload') || 'Drop to upload')
                : (t('scaffoldExtra', 'dragAndDropFile') || 'ファイルをドラッグ＆ドロップ')}
            </p>
            <p className="text-sm text-gray-500 mb-1">{t('scaffoldExtra', 'orClickToSelect') || 'またはクリックしてファイルを選択'}</p>
            <p className="text-xs text-gray-400 mb-3">{t('scaffoldExtra', 'noFileChosen') || 'No file chosen'}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {FILE_LABELS.map(ext => (
                <span key={ext} className="px-2.5 py-1 bg-white rounded-md border border-gray-200 text-xs font-medium text-gray-600">
                  {ext}
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">{t('scaffoldExtra', 'max50mbFormats') || '最大50MB — 画像・PDF・DXF対応'}</p>
          </div>
        </div>
      </div>
    );
  }

  // Phase: Processing
  if (phase === 'processing') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
          <p className="text-base font-medium text-gray-700">{status || (t('viewer', 'processingFile') || 'Processing file…')}</p>
          <p className="text-sm text-gray-500">{file?.name}</p>
        </div>
      </div>
    );
  }

  // Phase: Error
  if (phase === 'error') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="flex flex-col items-center gap-4">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="text-base font-medium text-red-700">{errMsg}</p>
          <button onClick={reset} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 flex items-center gap-2">
            <RotateCcw className="h-4 w-4" /> {t('scaffoldExtra', 'retry') || 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  // Phase: Editor
  const { verts, wallMm } = shape;
  const hasSvg = bgSegs.length > 0 || verts.length >= 2 || tracing;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <Check className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-gray-700 truncate max-w-xs">{file?.name}</span>
          <span className="px-2 py-0.5 bg-gray-200 rounded text-xs font-medium text-gray-600 uppercase">{kind}</span>
        </div>
        <div className="flex items-center gap-3">
          {status && <span className="text-xs text-green-600 hidden sm:inline">{status}</span>}
          <button onClick={reset} className="p-1.5 hover:bg-gray-200 rounded-lg" title={t('viewer', 'clear') || 'Reset'}>
            <RotateCcw className="h-4 w-4 text-gray-500" />
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row" style={{ minHeight: 520 }}>
        {/* Left: Drawing + Polygon SVG */}
        <div className="flex-1 relative bg-gray-100 overflow-hidden" style={{ minHeight: 400 }}>
          {previewUrl && (
            <img ref={imgRef} src={previewUrl} alt="" className="hidden" onLoad={onImgLoad} />
          )}

          {(hasSvg || (previewUrl && imgSize)) && (
            <svg
              ref={svgRef}
              className="absolute inset-0 w-full h-full"
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              preserveAspectRatio="xMidYMid meet"
              onMouseMove={onSvgMove}
              onMouseUp={onSvgUp}
              onMouseLeave={onSvgUp}
              onClick={onSvgClick}
              style={{ cursor: tracing ? 'crosshair' : dragIdx !== null ? 'grabbing' : 'default' }}
            >
              {previewUrl && imgSize && (
                <image href={previewUrl} x={0} y={0} width={imgSize.w} height={imgSize.h} />
              )}

              {bgSegs.map((seg, i) => (
                <line key={i} x1={seg.start.x} y1={seg.start.y} x2={seg.end.x} y2={seg.end.y}
                  stroke="#94a3b8" strokeWidth={sw * 0.4} strokeLinecap="round" />
              ))}

              {/* Closed polygon fill (when shape is finalized) */}
              {verts.length >= 3 && !tracing && (
                <polygon
                  points={verts.map(v => `${v.x},${v.y}`).join(' ')}
                  fill="rgba(59,130,246,0.06)" stroke="#2563eb" strokeWidth={sw} strokeLinejoin="round"
                />
              )}

              {/* Open polyline during tracing */}
              {tracing && verts.length >= 2 && (
                <polyline
                  points={verts.map(v => `${v.x},${v.y}`).join(' ')}
                  fill="none" stroke="#2563eb" strokeWidth={sw} strokeLinejoin="round"
                />
              )}

              {/* Closed polygon outline when finalized */}
              {!tracing && verts.length >= 3 && (
                <polygon
                  points={verts.map(v => `${v.x},${v.y}`).join(' ')}
                  fill="none" stroke="#2563eb" strokeWidth={sw} strokeLinejoin="round"
                />
              )}

              {/* Single line with 2 points */}
              {verts.length === 2 && !tracing && (
                <line x1={verts[0].x} y1={verts[0].y} x2={verts[1].x} y2={verts[1].y}
                  stroke="#2563eb" strokeWidth={sw} />
              )}

              {/* Edge dimension labels — shown for ALL edges including during tracing */}
              {verts.length >= 2 && verts.map((v, i) => {
                const isClosed = !tracing && verts.length >= 3;
                const nextIdx = isClosed ? (i + 1) % verts.length : i + 1;
                if (nextIdx >= verts.length) return null;
                const next = verts[nextIdx];
                const mid = midPt(v, next);
                const norm = edgeNorm(v, next, dimOff);
                const len = wallMm[i] || 0;
                const isPending = pendingDimIdx === i;

                return (
                  <g key={`e-${i}`}>
                    <rect
                      x={mid.x + norm.x - fs * 2.5} y={mid.y + norm.y - fs * 0.6}
                      width={fs * 5} height={fs * 1.2} rx={fs * 0.2}
                      fill={isPending ? '#dbeafe' : 'white'} fillOpacity={0.9}
                      stroke={isPending ? '#3b82f6' : '#dbeafe'} strokeWidth={isPending ? 1.5 : 0.5}
                    />
                    <text
                      x={mid.x + norm.x} y={mid.y + norm.y}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={fs} fontWeight="600" fill={isPending ? '#2563eb' : len > 0 ? '#1e40af' : '#f59e0b'}
                      style={{ userSelect: 'none' }}
                    >
                      {len > 0 ? fmtMeters(len) : `?${mUnit}`}
                    </text>

                    {!tracing && (
                      <g style={{ cursor: 'pointer' }} className="opacity-30 hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); addVertexOnEdge(i); }}>
                        <circle cx={mid.x} cy={mid.y} r={vtxR * 0.7} fill="white" stroke="#94a3b8" strokeWidth={1} />
                        <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="middle"
                          fontSize={fs * 0.55} fill="#64748b" style={{ pointerEvents: 'none' }}>+</text>
                      </g>
                    )}
                  </g>
                );
              })}

              {verts.map((v, i) => (
                <g key={`v-${i}`}>
                  <circle
                    cx={v.x} cy={v.y} r={vtxR}
                    fill={dragIdx === i ? '#f59e0b' : i === 0 ? '#22c55e' : '#2563eb'}
                    stroke="white" strokeWidth={vtxR * 0.4}
                    style={{ cursor: 'grab' }}
                    onMouseDown={(e) => onVtxDown(e, i)}
                  />
                  <text
                    x={v.x} y={v.y - vtxR * 2}
                    textAnchor="middle" fontSize={fs * 0.8} fontWeight="bold"
                    fill="#1e293b" stroke="white" strokeWidth={fs * 0.15} paintOrder="stroke"
                  >
                    {String.fromCharCode(65 + (i % 26))}
                  </text>
                </g>
              ))}
            </svg>
          )}

          {tracing && (
            <div className="absolute bottom-4 left-4 right-4 space-y-2">
              {/* Dimension input prompt — appears after clicking each new vertex */}
              {pendingDimIdx !== null && verts.length >= 2 && (
                <div className="bg-blue-50 border border-blue-300 rounded-lg px-4 py-3 flex items-center gap-3 shadow-md">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {String.fromCharCode(65 + ((pendingDimIdx) % 26))}
                    </span>
                    <span className="text-xs text-blue-600 font-medium">→</span>
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {String.fromCharCode(65 + ((pendingDimIdx + 1) % 26))}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={pendingDimVal}
                    onChange={(e) => setPendingDimVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyPendingDim();
                      if (e.key === 'Escape') skipPendingDim();
                    }}
                    placeholder={t('scaffoldExtra', 'dimensionPlaceholderM') || 'Length (m)'}
                    autoFocus
                    className="w-28 px-2 py-1.5 border border-blue-300 rounded text-sm font-mono text-right focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <span className="text-xs text-blue-500">{mUnit}</span>
                  <button onClick={applyPendingDim}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" /> {t('viewer', 'apply') || 'Apply'}
                  </button>
                  <button onClick={skipPendingDim}
                    className="px-2 py-1.5 text-blue-400 text-xs hover:text-blue-600">
                    {t('scaffoldExtra', 'skip') || 'Skip'}
                  </button>
                </div>
              )}
              {/* Trace mode guide bar */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2 text-sm text-amber-700">
                  <MousePointer2 className="h-4 w-4" />
                  <span>
                    {verts.length === 0
                      ? (t('scaffoldExtra', 'clickFirstVertexA') || 'Click to place the first vertex (A)')
                      : verts.length === 1
                        ? (t('scaffoldExtra', 'clickNextVertexB') || 'Click the next vertex (B)')
                        : `${t('scaffoldExtra', 'clickVerticesMin3Current') || 'Click vertices (min 3) - current'} ${verts.length}`}
                  </span>
                </div>
                {verts.length >= 3 && (
                  <button onClick={closeTrace}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-md hover:bg-green-700 flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" /> {(t('scaffoldExtra', 'confirmShape') || 'Confirm shape')} ({verts.length})
                  </button>
                )}
              </div>
            </div>
          )}

          {!previewUrl && bgSegs.length === 0 && verts.length === 0 && !tracing && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Building2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t('scaffoldExtra', 'drawingPreview') || 'Drawing preview'}</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Settings Panel */}
        <div className="w-full lg:w-96 flex flex-col border-t lg:border-t-0 lg:border-l border-gray-200">
          {/* Building Height */}
          <div className="p-4 border-b border-gray-200">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              {buildingHeightLabel || t('viewer', 'buildingHeight') || 'Building Height'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={0.01}
                value={
                  buildingHeightMm != null && buildingHeightMm >= 1000
                    ? Math.round((buildingHeightMm / 1000) * 1000) / 1000
                    : ''
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    onBuildingHeightChange(null);
                    return;
                  }
                  const m = Number(raw);
                  if (!Number.isFinite(m) || m <= 0) return;
                  onBuildingHeightChange(Math.round(m * 1000));
                }}
                placeholder={t('scaffoldExtra', 'heightPlaceholderM') || 'e.g. 3'}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="text-sm text-gray-500 w-8">{mUnit}</span>
            </div>
            {buildingHeightHint ? (
              <p className="text-xs text-gray-500 mt-1.5">{buildingHeightHint}</p>
            ) : null}
          </div>

          {/* Wall Dimensions */}
          <div className="flex-1 overflow-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Ruler className="h-4 w-4 text-blue-600" />
                {t('scaffoldExtra', 'wallDimensions') || 'Wall Dimensions'}
              </h3>
              {perimeter > 0 && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  {(t('viewer', 'perimeterLabel') || 'Perimeter')}: {(perimeter / 1000).toFixed(2)}{mUnit}
                </span>
              )}
            </div>

            {verts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                {t('scaffoldExtra', 'clickToPlaceVerticesHint') || 'Click on the drawing to place vertices and show wall dimensions'}
              </p>
            ) : verts.length === 1 ? (
              <div className="text-center py-6">
                <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 text-xs font-bold flex items-center justify-center mx-auto mb-2">A</div>
                <p className="text-sm text-gray-500">{t('scaffoldExtra', 'vertexAPlacedClickB') || 'Vertex A is placed. Click the next vertex B.'}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {/* Show edges from the polygon (or trace-in-progress lines) */}
                {wallMm.map((len, i) => {
                  if (i >= verts.length) return null;
                  const isClosed = !tracing && verts.length >= 3;
                  const isLastOpenEdge = !isClosed && i === verts.length - 1;
                  if (isLastOpenEdge) return null;

                  const isPending = pendingDimIdx === i;
                  const lA = String.fromCharCode(65 + (i % 26));
                  const nextIdx = isClosed ? (i + 1) % verts.length : i + 1;
                  const lB = String.fromCharCode(65 + (nextIdx % 26));
                  const dxM =
                    shape.coordsAreMm && nextIdx < verts.length
                      ? (verts[nextIdx].x - verts[i].x) / 1000
                      : null;
                  const dyM =
                    shape.coordsAreMm && nextIdx < verts.length
                      ? (verts[nextIdx].y - verts[i].y) / 1000
                      : null;
                  const hMm =
                    (wallHeightsMm.length > i ? wallHeightsMm[i] : undefined) ??
                    buildingHeightMm ??
                    0;
                  const planAxis = edgePlanAxes[i] ?? 'X';
                  const planAxisMm =
                    edgePlanAxisMm.length > i ? edgePlanAxisMm[i]! : (planAxis === 'X' && dxM != null
                      ? Math.round(dxM * 1000)
                      : planAxis === 'Y' && dyM != null
                        ? Math.round(dyM * 1000)
                        : 0);

                  const fieldBox = 'rounded-md border border-gray-200 bg-white/90 p-1.5 shadow-sm';

                  return (
                    <div
                      key={i}
                      className={`rounded-lg border px-2 py-2 transition-colors ${
                        isPending
                          ? 'bg-blue-50 ring-2 ring-blue-300 border-blue-200'
                          : len > 0
                            ? 'bg-gray-50 border-gray-200'
                            : 'bg-amber-50/80 border border-dashed border-amber-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <span className="text-[11px] font-bold text-blue-800">
                          {lA}→{lB}
                        </span>
                        {verts.length > 3 && !tracing && (
                          <button
                            type="button"
                            onClick={() => deleteVertex(i)}
                            className="p-0.5 text-gray-400 hover:text-red-500 rounded"
                            title={t('scaffoldExtra', 'deleteVertex') || 'Delete vertex'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                        <div className={fieldBox}>
                          <span className="text-[10px] text-gray-500 block mb-0.5">L ({mUnit})</span>
                          <input
                            type="number"
                            min={0.01}
                            step={0.01}
                            value={len > 0 ? Math.round((len / 1000) * 1000) / 1000 : ''}
                            onChange={(e) => {
                              const mm = parseMetersInputToMm(e.target.value);
                              if (mm != null) editWallLength(i, mm);
                            }}
                            className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px] font-mono"
                          />
                        </div>
                        <div className={fieldBox}>
                          <span className="text-[10px] text-gray-500 block mb-0.5">H ({mUnit})</span>
                          {onWallHeightMmChange ? (
                            <input
                              type="number"
                              min={1}
                              step={0.01}
                              value={hMm >= 1000 ? Math.round((hMm / 1000) * 1000) / 1000 : ''}
                              onChange={(e) => {
                                const mm = parseMetersInputToMm(e.target.value);
                                if (mm != null && mm >= 1000) onWallHeightMmChange(i, mm);
                              }}
                              className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px] font-mono"
                            />
                          ) : (
                            <span className="text-[11px] text-gray-700 block py-0.5">
                              {hMm >= 1000 ? `${(hMm / 1000).toFixed(2)}` : '—'}
                            </span>
                          )}
                        </div>
                        <div className={fieldBox}>
                          <span className="text-[10px] text-gray-500 block mb-0.5">
                            {t('scaffoldExtra', 'edgeXYRun') || 'XY'}
                          </span>
                          <div className="flex gap-1.5 items-center">
                            <select
                              value={planAxis}
                              disabled={!onEdgePlanAxisChange}
                              onChange={(e) =>
                                onEdgePlanAxisChange?.(i, e.target.value as 'X' | 'Y')
                              }
                              className="w-11 shrink-0 rounded border border-gray-200 px-1 py-0.5 text-[11px] font-semibold bg-gray-50 disabled:opacity-60"
                            >
                              <option value="X">X</option>
                              <option value="Y">Y</option>
                            </select>
                            <input
                              type="number"
                              step="any"
                              value={planAxisMm / 1000}
                              onChange={(e) => {
                                const mm = parseSignedMetersToMm(e.target.value);
                                if (mm != null) onEdgePlanAxisMmChange?.(i, mm);
                              }}
                              disabled={!onEdgePlanAxisMmChange}
                              className="min-w-0 flex-1 px-1.5 py-0.5 border border-gray-200 rounded text-[11px] font-mono disabled:opacity-60"
                            />
                            <span className="text-[10px] text-gray-400 shrink-0">{mUnit}</span>
                          </div>
                          {dxM != null && dyM != null ? (
                            <p className="text-[9px] text-gray-400 mt-0.5 font-mono truncate" title="Geometry">
                              ΔX {dxM.toFixed(2)} · ΔY {dyM.toFixed(2)} {mUnit}
                            </p>
                          ) : null}
                        </div>
                        {onWallCfNoteChange ? (
                          <div className={fieldBox}>
                            <span className="text-[10px] text-gray-500 block mb-0.5">CF</span>
                            <select
                              value={normalizeScaffoldWallCfKey(wallCfNotes[i])}
                              onChange={(e) => {
                                onWallCfNoteChange(
                                  i,
                                  normalizeScaffoldWallCfKey(e.target.value),
                                );
                              }}
                              className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px] bg-white"
                            >
                              {SCAFFOLD_WALL_CF_KEYS.map((cfKey) => (
                                <option key={cfKey || '_none'} value={cfKey}>
                                  {t('scaffoldExtra', SCAFFOLD_WALL_CF_LABEL_KEYS[cfKey]) || cfKey || '—'}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {/* Show vertex count summary during tracing */}
                {tracing && verts.length >= 2 && (
                  <div className="text-xs text-gray-500 text-center pt-2 border-t border-gray-100 mt-2">
                    {verts.length} {t('scaffoldExtra', 'vertices') || 'vertices'} - {wallMm.filter(w => w > 0).length}/{verts.length - 1} {t('scaffoldExtra', 'edgesDimensioned') || 'edges dimensioned'}
                  </div>
                )}
              </div>
            )}
          </div>

          {onEdgeHashiraRowChange &&
            edgeHashiraRows.length > 0 &&
            externalWallLengths.length === edgeHashiraRows.length && (
              <div className="p-4 border-t border-gray-200 bg-slate-50/40 shrink-0">
                <EdgeHashiraPlanningPanel
                  wallCount={externalWallLengths.length}
                  lengthsMm={externalWallLengths}
                  rows={edgeHashiraRows}
                  onRowChange={onEdgeHashiraRowChange}
                  closedFootprint={!tracing && verts.length >= 3}
                />
              </div>
            )}

          {/* Footer Actions */}
          <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center gap-2">
            {tracing ? (
              <button onClick={closeTrace} disabled={verts.length < 3}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <Check className="h-4 w-4" /> {(t('scaffoldExtra', 'confirmShape') || 'Confirm shape')} ({verts.length})
              </button>
            ) : verts.length >= 3 ? (
              <button onClick={() => { setTracing(true); setShape(prev => ({ ...prev, verts: [], wallMm: [] })); }}
                className="flex-1 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2">
                <Pencil className="h-4 w-4" /> {t('scaffoldExtra', 'reselectVertices') || 'Reselect vertices'}
              </button>
            ) : null}
            <button onClick={reset}
              className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2">
              <RotateCcw className="h-4 w-4" /> {t('viewer', 'clear') || 'Reset'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
