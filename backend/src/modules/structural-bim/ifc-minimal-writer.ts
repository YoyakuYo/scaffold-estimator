import { randomBytes } from 'crypto';
import type { PlacedBeam, PlacedColumn, PlacedConnection, PlacedSlab } from './placement';
import { profileSpec, type ProfileSpec } from './profile-sizes';

function esc(s: string): string {
  return String(s).replace(/'/g, "''");
}

function guid22(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  const buf = randomBytes(22);
  let out = '';
  for (let i = 0; i < 22; i++) out += alphabet[buf[i]! % alphabet.length];
  return out;
}

function f(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toFixed(6);
}

/** #RRGGBB or rgb(r,g,b) → 0–1 RGB for IfcColourRgb */
export function parsePhaseColor(hex?: string): { r: number; g: number; b: number } | null {
  if (!hex || typeof hex !== 'string') return null;
  const s = hex.trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  return null;
}

type Id = number;

type AddFn = (expr: string) => Id;

function addProfileExtrusion(add: AddFn, spec: ProfileSpec): { prof: Id; extDir: Id } {
  const extDir = add(`IFCDIRECTION((0.,0.,1.))`);
  if (spec.kind === 'rectangle') {
    const bx = spec.bMm / 1000;
    const dy = spec.dMm / 1000;
    const p2d = add(`IFCCARTESIANPOINT((${f(-bx / 2)},${f(-dy / 2)}))`);
    const ax2 = add(`IFCAXIS2PLACEMENT2D(#${p2d},$)`);
    const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${ax2},${f(bx)},${f(dy)})`);
    return { prof, extDir };
  }
  const B = spec.widthMm / 1000;
  const D = spec.depthMm / 1000;
  const tw = spec.webMm / 1000;
  const tf = spec.flangeMm / 1000;
  const p2d = add(`IFCCARTESIANPOINT((${f(-B / 2)},${f(-D / 2)}))`);
  const ax2 = add(`IFCAXIS2PLACEMENT2D(#${p2d},$)`);
  const prof = add(
    `IFCISHAPEROFILEDEF(.AREA.,'H',#${ax2},${f(B)},${f(D)},${f(tw)},${f(tf)},$,$,$,$,$)`,
  );
  return { prof, extDir };
}

function addStyledItemForSolid(add: AddFn, solidId: Id, color?: string): void {
  const rgb = parsePhaseColor(color);
  if (!rgb) return;
  const clr = add(`IFCCOLOURRGB($,${f(rgb.r)},${f(rgb.g)},${f(rgb.b)})`);
  const rend = add(`IFCSURFACESTYLERENDERING(#${clr},$,$,$,$,$,$,$,$)`);
  const surf = add(`IFCSURFACESTYLE($,.BOTH.,(#${rend}))`);
  add(`IFCSTYLEDITEM(#${solidId},(#${surf}),$)`);
}

export interface StoreyIfcInput {
  id: string;
  name: string;
  elevationBottomM: number;
}

/**
 * IFC4 SPF: multiple IfcBuildingStorey, IfcColumn / IfcBeam with rectangle or I-shape profiles,
 * optional IfcSlab per storey, IfcPlate connection proxies, IfcSurfaceStyle from phaseColor.
 */
export function buildStructuralIfcDocument(input: {
  projectName: string;
  storeys: StoreyIfcInput[];
  columns: PlacedColumn[];
  beams: PlacedBeam[];
  slabs?: PlacedSlab[];
  connections?: PlacedConnection[];
}): string {
  const parts: string[] = [];
  let id = 0;
  const add: AddFn = (expr: string): Id => {
    id += 1;
    parts.push(`#${id}=${expr}`);
    return id;
  };

  const org = add(`IFCORGANIZATION($,'Zoomen',$,$,$)`);
  const app = add(`IFCAPPLICATION(#${org},'1.0','Structural generator','structural-bim')`);
  const person = add(`IFCPERSON($,'User',$,$,$,$,$,$)`);
  const po = add(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const owner = add(`IFCOWNERHISTORY(#${po},#${app},$,.NOCHANGE.,$,$,$,${Date.now()})`);

  const lenSi = add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
  const unitAssign = add(`IFCUNITASSIGNMENT((#${lenSi}))`);

  const origin = add(`IFCCARTESIANPOINT((0.,0.,0.))`);
  const dirZ = add(`IFCDIRECTION((0.,0.,1.))`);
  const dirX = add(`IFCDIRECTION((1.,0.,0.))`);
  const axisWorld = add(`IFCAXIS2PLACEMENT3D(#${origin},#${dirZ},#${dirX})`);
  const geoCtx = add(
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${axisWorld},$)`,
  );
  add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${geoCtx},$,.MODEL_VIEW.,$)`);

  const project = add(
    `IFCPROJECT('${guid22()}',#${owner},'${esc(input.projectName)}',$,$,$,$,(#${geoCtx}),#${unitAssign})`,
  );
  const site = add(`IFCSITE('${guid22()}',#${owner},$,$,$,$,$,.ELEMENT.,$,$,$,$,$)`);
  const building = add(`IFCBUILDING('${guid22()}',#${owner},$,$,$,$,$,$,.ELEMENT.,$,$,$)`);

  const sorted = [...input.storeys].sort((a, b) => a.elevationBottomM - b.elevationBottomM);
  const storeyExprById: Record<string, Id> = {};
  const storeyIds: Id[] = [];
  for (const s of sorted) {
    const sid = add(
      `IFCBUILDINGSTOREY('${guid22()}',#${owner},'${esc(s.name)}',$,$,$,#${axisWorld},$,.ELEMENT.,${f(
        s.elevationBottomM,
      )})`,
    );
    storeyExprById[s.id] = sid;
    storeyIds.push(sid);
  }

  add(`IFCRELAGGREGATES('${guid22()}',#${owner},$,$,#${project},(#${site}))`);
  add(`IFCRELAGGREGATES('${guid22()}',#${owner},$,$,#${site},(#${building}))`);
  const storeyList = storeyIds.map((i) => `#${i}`).join(',');
  add(`IFCRELAGGREGATES('${guid22()}',#${owner},$,$,#${building},(${storeyList}))`);

  const byStorey: Record<string, Id[]> = {};
  const push = (storeyKey: string, productId: Id) => {
    if (!byStorey[storeyKey]) byStorey[storeyKey] = [];
    byStorey[storeyKey]!.push(productId);
  };

  for (const c of input.columns) {
    const spec = profileSpec(c.profileName);
    const xm = c.xMm / 1000;
    const ym = c.yMm / 1000;
    const zb = c.zBottomMm / 1000;
    const h = c.heightMm / 1000;

    const loc = add(`IFCCARTESIANPOINT((${f(xm)},${f(ym)},${f(zb)}))`);
    const za = add(`IFCDIRECTION((0.,0.,1.))`);
    const xa = add(`IFCDIRECTION((1.,0.,0.))`);
    const ax3 = add(`IFCAXIS2PLACEMENT3D(#${loc},#${za},#${xa})`);
    const lp = add(`IFCLOCALPLACEMENT($,#${ax3})`);

    const { prof, extDir } = addProfileExtrusion(add, spec);
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},$,#${extDir},${f(h)})`);
    addStyledItemForSolid(add, solid, c.phaseColor);
    const shp = add(`IFCSHAPEREPRESENTATION(#${geoCtx},'Body','SweptSolid',(#${solid}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,(#${shp}))`);

    const col = add(
      `IFCCOLUMN('${guid22()}',#${owner},'${esc(c.mark)}',$,$,#${lp},#${pds},$,$,.NOTDEFINED.)`,
    );
    push(c.storeyId, col);
  }

  for (const b of input.beams) {
    const spec = profileSpec(b.profileName);
    const x1 = b.x1Mm / 1000;
    const y1 = b.y1Mm / 1000;
    const x2 = b.x2Mm / 1000;
    const y2 = b.y2Mm / 1000;
    const z = b.zMm / 1000;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    const zx = add(`IFCDIRECTION((${f(ux)},${f(uy)},0.))`);
    const xx = add(`IFCDIRECTION((${f(-uy)},${f(ux)},0.))`);
    const loc = add(`IFCCARTESIANPOINT((${f(x1)},${f(y1)},${f(z)}))`);
    const ax3 = add(`IFCAXIS2PLACEMENT3D(#${loc},#${zx},#${xx})`);
    const lp = add(`IFCLOCALPLACEMENT($,#${ax3})`);

    const { prof, extDir } = addProfileExtrusion(add, spec);
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},$,#${extDir},${f(len)})`);
    addStyledItemForSolid(add, solid, b.phaseColor);
    const shp = add(`IFCSHAPEREPRESENTATION(#${geoCtx},'Body','SweptSolid',(#${solid}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,(#${shp}))`);

    const beam = add(
      `IFCBEAM('${guid22()}',#${owner},'${esc(b.mark)}',$,$,#${lp},#${pds},$,$,.NOTDEFINED.)`,
    );
    push(b.storeyId, beam);
  }

  for (const slab of input.slabs ?? []) {
    const w = (slab.xMaxMm - slab.xMinMm) / 1000;
    const d = (slab.yMaxMm - slab.yMinMm) / 1000;
    const zb = slab.zBottomMm / 1000;
    const th = slab.thicknessMm / 1000;
    const xm = slab.xMinMm / 1000;
    const ym = slab.yMinMm / 1000;

    const loc = add(`IFCCARTESIANPOINT((${f(xm)},${f(ym)},${f(zb)}))`);
    const za = add(`IFCDIRECTION((0.,0.,1.))`);
    const xa = add(`IFCDIRECTION((1.,0.,0.))`);
    const ax3 = add(`IFCAXIS2PLACEMENT3D(#${loc},#${za},#${xa})`);
    const lp = add(`IFCLOCALPLACEMENT($,#${ax3})`);

    const p2d = add(`IFCCARTESIANPOINT((0.,0.))`);
    const ax2 = add(`IFCAXIS2PLACEMENT2D(#${p2d},$)`);
    const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${ax2},${f(w)},${f(d)})`);
    const extDir = add(`IFCDIRECTION((0.,0.,1.))`);
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},$,#${extDir},${f(th)})`);
    addStyledItemForSolid(add, solid, slab.phaseColor);
    const shp = add(`IFCSHAPEREPRESENTATION(#${geoCtx},'Body','SweptSolid',(#${solid}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,(#${shp}))`);

    const slabEl = add(
      `IFCSLAB('${guid22()}',#${owner},'${esc(slab.name)}',$,$,#${lp},#${pds},$,$,.FLOOR.)`,
    );
    push(slab.storeyId, slabEl);
  }

  for (const conn of input.connections ?? []) {
    const s = conn.sizeMm / 1000;
    const th = conn.thicknessMm / 1000;
    const xm = (conn.xMm - conn.sizeMm / 2) / 1000;
    const ym = (conn.yMm - conn.sizeMm / 2) / 1000;
    const zb = conn.zBottomMm / 1000;

    const loc = add(`IFCCARTESIANPOINT((${f(xm)},${f(ym)},${f(zb)}))`);
    const za = add(`IFCDIRECTION((0.,0.,1.))`);
    const xa = add(`IFCDIRECTION((1.,0.,0.))`);
    const ax3 = add(`IFCAXIS2PLACEMENT3D(#${loc},#${za},#${xa})`);
    const lp = add(`IFCLOCALPLACEMENT($,#${ax3})`);

    const p2d = add(`IFCCARTESIANPOINT((0.,0.))`);
    const ax2 = add(`IFCAXIS2PLACEMENT2D(#${p2d},$)`);
    const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${ax2},${f(s)},${f(s)})`);
    const extDir = add(`IFCDIRECTION((0.,0.,1.))`);
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},$,#${extDir},${f(th)})`);
    addStyledItemForSolid(add, solid, conn.phaseColor);
    const shp = add(`IFCSHAPEREPRESENTATION(#${geoCtx},'Body','SweptSolid',(#${solid}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,(#${shp}))`);

    const plate = add(
      `IFCPLATE('${guid22()}',#${owner},'${esc(conn.mark)}',$,$,#${lp},#${pds},$,$,.SHEET.)`,
    );
    push(conn.storeyId, plate);
  }

  for (const s of sorted) {
    const relStorey = storeyExprById[s.id];
    if (!relStorey) continue;
    const prods = byStorey[s.id];
    if (!prods?.length) continue;
    const listInner = prods.map((i) => `#${i}`).join(',');
    add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid22()}',#${owner},$,$,(${listInner}),#${relStorey})`);
  }

  const data = parts.join(';\n') + ';\n';
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('structural.ifc','${new Date().toISOString()}',(''),(''),'structural-bim','','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    data,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');
}
