import { defaultStructuralModel } from './structural-model.types';
import { placeMembers } from './placement';
import { buildStructuralIfcDocument } from './ifc-minimal-writer';
import { mergeMembersFromCsv } from './csv-import';

describe('structural-bim pipeline', () => {
  it('places columns and beams from default model', () => {
    const model = defaultStructuralModel();
    const { columns, beams } = placeMembers(model);
    expect(columns.length).toBeGreaterThan(0);
    expect(beams.length).toBeGreaterThan(0);
    expect(columns[0]!.heightMm).toBe(4000);
  });

  it('emits IFC4 header and beam/column entities', () => {
    const model = defaultStructuralModel();
    const { columns, beams } = placeMembers(model);
    const doc = buildStructuralIfcDocument({
      projectName: 'Test',
      storeyName: '1F',
      storeyElevationM: 0,
      columns,
      beams,
    });
    expect(doc).toContain('ISO-10303-21');
    expect(doc).toContain('IFC4');
    expect(doc).toContain('IFCCOLUMN');
    expect(doc).toContain('IFCBEAM');
    expect(doc).toContain('IFCRELCONTAINEDINSPATIALSTRUCTURE');
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
});
