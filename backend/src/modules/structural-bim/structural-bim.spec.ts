import { defaultStructuralModel } from './structural-model.types';
import {
  computeFrameConnections,
  computeSlabsPerStorey,
  placeMembers,
} from './placement';
import { buildStructuralIfcDocument, parsePhaseColor } from './ifc-minimal-writer';
import { mergeMembersFromCsv } from './csv-import';
import { profileSpec } from './profile-sizes';

describe('structural-bim pipeline', () => {
  it('places columns and beams from default model', () => {
    const model = defaultStructuralModel();
    const { columns, beams } = placeMembers(model);
    expect(columns.length).toBeGreaterThanOrEqual(3);
    expect(beams.length).toBe(2);
    expect(columns[0]!.heightMm).toBe(4000);
    expect(columns[0]!.storeyId).toBe('s1');
  });

  it('emits multi-storey IFC with I-shape, slabs, plates, and styles', () => {
    const model = defaultStructuralModel();
    const { columns, beams } = placeMembers(model);
    const slabs = computeSlabsPerStorey(model);
    const connections = computeFrameConnections(model);
    expect(connections.length).toBeGreaterThan(0);
    const doc = buildStructuralIfcDocument({
      projectName: 'Test',
      storeys: model.storeys.map((s) => ({
        id: s.id,
        name: s.name,
        elevationBottomM: s.elevationBottomMm / 1000,
      })),
      columns,
      beams,
      slabs,
      connections,
    });
    expect(doc).toContain('ISO-10303-21');
    expect(doc).toContain('IFC4');
    expect(doc).toContain('IFCCOLUMN');
    expect(doc).toContain('IFCBEAM');
    expect(doc).toContain('IFCISHAPEROFILEDEF');
    expect(doc).toContain('IFCSLAB');
    expect(doc).toContain('IFCPLATE');
    expect(doc).toContain('IFCSTYLEDITEM');
    expect((doc.match(/IFCBUILDINGSTOREY/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((doc.match(/IFCRELCONTAINEDINSPATIALSTRUCTURE/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('parses member CSV', () => {
    const model = defaultStructuralModel();
    const csv = `mark,category,profile,storeyId,xLabel,yLabel,x2Label,y2Label
C9,column,H400x200,s1,X1,Y1,,
B9,beam,H300x150,s1,X1,Y1,X3,Y1`;
    const next = mergeMembersFromCsv(model, csv);
    expect(next.members).toHaveLength(2);
    expect(next.members[0]!.mark).toBe('C9');
    expect(next.members[1]!.category).toBe('beam');
  });

  it('parses hex phase colors', () => {
    const c = parsePhaseColor('#ff00aa');
    expect(c).toEqual({ r: 1, g: 0, b: 170 / 255 });
    expect(parsePhaseColor(undefined)).toBeNull();
  });

  it('classifies H sections as I-shape', () => {
    const s = profileSpec('H400x200');
    expect(s.kind).toBe('ishape');
    if (s.kind === 'ishape') {
      expect(s.depthMm).toBe(400);
      expect(s.widthMm).toBe(200);
    }
  });
});
