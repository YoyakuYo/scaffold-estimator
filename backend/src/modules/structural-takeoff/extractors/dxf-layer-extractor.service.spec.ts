import { DxfLayerExtractorService } from './dxf-layer-extractor.service';

/**
 * Minimal valid DXF text with three entities on three different layers
 * exercising the structural element classifier. dxf-parser accepts very
 * small DXF inputs as long as the EOF marker is present and the structure
 * follows the section/header/entities/eof sequence.
 */
function buildDxf(entities: Array<{ layer: string }>): string {
  const lines: string[] = [];
  lines.push('0', 'SECTION', '2', 'HEADER', '0', 'ENDSEC');
  lines.push('0', 'SECTION', '2', 'TABLES');
  lines.push('0', 'TABLE', '2', 'LAYER');
  for (const ent of entities) {
    lines.push('0', 'LAYER', '2', ent.layer, '70', '0', '62', '7', '6', 'CONTINUOUS');
  }
  lines.push('0', 'ENDTAB', '0', 'ENDSEC');
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  for (const ent of entities) {
    lines.push('0', 'LINE', '8', ent.layer, '10', '0.0', '20', '0.0', '30', '0.0', '11', '1.0', '21', '0.0', '31', '0.0');
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

describe('DxfLayerExtractorService', () => {
  const svc = new DxfLayerExtractorService();

  it('counts entities per known structural layer', () => {
    const dxf = buildDxf([
      { layer: 'S-柱' },
      { layer: 'S-柱' },
      { layer: 'S-大梁' },
    ]);
    const r = svc.extractFromText(dxf, '1F');
    const hashiraProp = r.proposals.find((p) => p.elementType === 'hashira');
    const oobariProp = r.proposals.find((p) => p.elementType === 'oobari');
    expect(hashiraProp).toBeDefined();
    expect(hashiraProp!.qty).toBe(2);
    expect(oobariProp).toBeDefined();
    expect(oobariProp!.qty).toBe(1);
  });

  it('infers level from layer name when present', () => {
    const dxf = buildDxf([{ layer: 'S-2F-小梁' }]);
    const r = svc.extractFromText(dxf, '1F');
    expect(r.proposals[0].level).toBe('2F');
  });

  it('returns warnings when no structural layers match', () => {
    const dxf = buildDxf([{ layer: 'CONSTRUCTION' }]);
    const r = svc.extractFromText(dxf, '1F');
    expect(r.proposals.length).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
