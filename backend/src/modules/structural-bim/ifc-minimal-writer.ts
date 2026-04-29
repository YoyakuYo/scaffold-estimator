import { randomBytes } from 'crypto';
import type { PlacedBeam, PlacedColumn } from './placement';
import { profileRectangleMm } from './profile-sizes';

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

type Id = number;

/** Phase 4 — minimal IFC4 SPF with IfcColumn / IfcBeam + extruded solids (metres). */
export function buildStructuralIfcDocument(input: {
  projectName: string;
  storeyName: string;
  storeyElevationM: number;
  columns: PlacedColumn[];
  beams: PlacedBeam[];
}): string {
  const parts: string[] = [];
  let id = 0;
  const add = (expr: string): Id => {
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
  const storey = add(
    `IFCBUILDINGSTOREY('${guid22()}',#${owner},'${esc(input.storeyName)}',$,$,$,#${axisWorld},$,.ELEMENT.,${f(
      input.storeyElevationM,
    )})`,
  );

  add(`IFCRELAGGREGATES('${guid22()}',#${owner},$,$,#${project},(#${site}))`);
  add(`IFCRELAGGREGATES('${guid22()}',#${owner},$,$,#${site},(#${building}))`);
  add(`IFCRELAGGREGATES('${guid22()}',#${owner},$,$,#${building},(#${storey}))`);

  const productIds: Id[] = [];

  for (const c of input.columns) {
    const { bMm, dMm } = profileRectangleMm(c.profileName);
    const bx = bMm / 1000;
    const dy = dMm / 1000;
    const xm = c.xMm / 1000;
    const ym = c.yMm / 1000;
    const zb = c.zBottomMm / 1000;
    const h = c.heightMm / 1000;

    const loc = add(`IFCCARTESIANPOINT((${f(xm)},${f(ym)},${f(zb)}))`);
    const za = add(`IFCDIRECTION((0.,0.,1.))`);
    const xa = add(`IFCDIRECTION((1.,0.,0.))`);
    const ax3 = add(`IFCAXIS2PLACEMENT3D(#${loc},#${za},#${xa})`);
    const lp = add(`IFCLOCALPLACEMENT($,#${ax3})`);

    const p2d = add(`IFCCARTESIANPOINT((${f(-bx / 2)},${f(-dy / 2)}))`);
    const ax2 = add(`IFCAXIS2PLACEMENT2D(#${p2d},$)`);
    const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${ax2},${f(bx)},${f(dy)})`);
    const extDir = add(`IFCDIRECTION((0.,0.,1.))`);
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},$,#${extDir},${f(h)})`);
    const shp = add(`IFCSHAPEREPRESENTATION(#${geoCtx},'Body','SweptSolid',(#${solid}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,(#${shp}))`);

    const col = add(
      `IFCCOLUMN('${guid22()}',#${owner},'${esc(c.mark)}',$,$,#${lp},#${pds},$,$,.NOTDEFINED.)`,
    );
    productIds.push(col);
  }

  for (const b of input.beams) {
    const { bMm, dMm } = profileRectangleMm(b.profileName);
    const pw = bMm / 1000;
    const ph = dMm / 1000;
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

    const p2d = add(`IFCCARTESIANPOINT((${f(-pw / 2)},${f(-ph / 2)}))`);
    const ax2 = add(`IFCAXIS2PLACEMENT2D(#${p2d},$)`);
    const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${ax2},${f(pw)},${f(ph)})`);
    const extDir = add(`IFCDIRECTION((0.,0.,1.))`);
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},$,#${extDir},${f(len)})`);
    const shp = add(`IFCSHAPEREPRESENTATION(#${geoCtx},'Body','SweptSolid',(#${solid}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,(#${shp}))`);

    const beam = add(
      `IFCBEAM('${guid22()}',#${owner},'${esc(b.mark)}',$,$,#${lp},#${pds},$,$,.NOTDEFINED.)`,
    );
    productIds.push(beam);
  }

  if (productIds.length) {
    const listInner = productIds.map((i) => `#${i}`).join(',');
    add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid22()}',#${owner},$,$,(${listInner}),#${storey})`);
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
