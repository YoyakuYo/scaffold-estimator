/**
 * Minimal IFC4 SPF export for AI-derived extruded shells (IfcExtrudedAreaSolid).
 * Browser-safe (crypto.getRandomValues). Intended for coordination / hand-off, not full BIM.
 */

import type { VisionFootprintResult } from '@/lib/api/vision-bim';
import { getVisionFootprintExtrusionsPlanMm } from '@/lib/bim/vision-footprint-bim-mesh';

function esc(s: string): string {
  return String(s).replace(/'/g, "''");
}

function f(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toFixed(6);
}

function guid22(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  const buf = new Uint8Array(22);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < 22; i++) out += alphabet[buf[i]! % alphabet.length];
  return out;
}

type Id = number;
type AddFn = (expr: string) => Id;

export function buildIfc4ShellFromVisionFootprint(
  result: VisionFootprintResult,
  options?: { projectName?: string; sourceFilename?: string },
): { ifcText: string; warnings: string[] } {
  const { extrusions, warnings } = getVisionFootprintExtrusionsPlanMm(result);
  if (extrusions.length === 0) {
    return { ifcText: '', warnings };
  }

  const parts: string[] = [];
  let id = 0;
  const add: AddFn = (expr: string): Id => {
    id += 1;
    parts.push(`#${id}=${expr}`);
    return id;
  };

  const projectName = esc(options?.projectName || 'AI building shell');
  const org = add(`IFCORGANIZATION($,'Zoomen',$,$,$)`);
  const app = add(`IFCAPPLICATION(#${org},'1.0','BIM viewer','bim-viewer')`);
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
    `IFCPROJECT('${guid22()}',#${owner},'${projectName}',$,$,$,$,(#${geoCtx}),#${unitAssign})`,
  );
  const site = add(`IFCSITE('${guid22()}',#${owner},$,$,$,$,$,.ELEMENT.,$,$,$,$,$)`);
  const building = add(`IFCBUILDING('${guid22()}',#${owner},$,$,$,$,$,$,.ELEMENT.,$,$,$)`);

  const storey = add(
    `IFCBUILDINGSTOREY('${guid22()}',#${owner},'Ground',$,$,$,#${axisWorld},$,.ELEMENT.,${f(0)})`,
  );

  add(`IFCRELAGGREGATES('${guid22()}',#${owner},$,$,#${project},(#${site}))`);
  add(`IFCRELAGGREGATES('${guid22()}',#${owner},$,$,#${site},(#${building}))`);
  add(`IFCRELAGGREGATES('${guid22()}',#${owner},$,$,#${building},(#${storey}))`);

  const products: Id[] = [];

  extrusions.forEach((ex, idx) => {
    const baseM = ex.baseMm / 1000;
    const depthM = ex.heightMm / 1000;
    if (depthM <= 1e-6) return;

    const ptIds: Id[] = [];
    for (const p of ex.ringMm) {
      const xm = p.x / 1000;
      const ym = p.y / 1000;
      ptIds.push(add(`IFCCARTESIANPOINT((${f(xm)},${f(ym)},0.))`));
    }
    if (ex.ringMm.length >= 2) {
      ptIds.push(ptIds[0]!);
    }
    const lineList = ptIds.map((i) => `#${i}`).join(',');
    const poly = add(`IFCPOLYLINE((${lineList}))`);
    const prof = add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${poly})`);
    const extDir = add(`IFCDIRECTION((0.,0.,1.))`);
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},$,#${extDir},${f(depthM)})`);

    const locPt = add(`IFCCARTESIANPOINT((0.,0.,${f(baseM)}))`);
    const ax3 = add(`IFCAXIS2PLACEMENT3D(#${locPt},#${dirZ},#${dirX})`);
    const lp = add(`IFCLOCALPLACEMENT($,#${ax3})`);

    const shp = add(`IFCSHAPEREPRESENTATION(#${geoCtx},'Body','SweptSolid',(#${solid}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,(#${shp}))`);

    const name = esc(`Shell ${idx + 1}`);
    const proxy = add(
      `IFCBUILDINGELEMENTPROXY('${guid22()}',#${owner},'${name}',$,$,#${lp},#${pds},$,.NOTDEFINED.)`,
    );
    products.push(proxy);
  });

  if (products.length > 0) {
    const listInner = products.map((i) => `#${i}`).join(',');
    add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid22()}',#${owner},$,$,(${listInner}),#${storey})`);
  }

  const data = parts.join(';\n') + ';\n';
  const baseFname = options?.sourceFilename?.replace(/\.[^.]+$/, '') || 'ai-shell';
  const ifcText = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('${esc(baseFname)}.ifc','${new Date().toISOString()}',(''),(''),'zoomen-bim-viewer','','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    data,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');

  return { ifcText, warnings };
}

export function downloadTextFile(filename: string, text: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
