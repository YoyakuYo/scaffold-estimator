import { ExcelElementImportService } from './excel-import.service';

describe('ExcelElementImportService — CSV parsing', () => {
  const svc = new ExcelElementImportService();

  it('maps Hb/HB + digits (耐風梁 marks) to taifubari', async () => {
    const csv = ['階,部材,数量', '2F,Hb30,4', '3F,HB125,2'].join('\n');
    const r = await svc.parseBuffer(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(r.rows.length).toBe(2);
    expect(r.rows[0].elementType).toBe('taifubari');
    expect(r.rows[1].elementType).toBe('taifubari');
  });

  it('maps CB/CG cantilever marks to katamochibari', async () => {
    const csv = ['階,部材,数量', '2F,CB30,2', '3F,cg12,1'].join('\n');
    const r = await svc.parseBuffer(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(r.rows.length).toBe(2);
    expect(r.rows[0].elementType).toBe('katamochibari');
    expect(r.rows[1].elementType).toBe('katamochibari');
  });

  it('infers element type from 符号 when 部材 cell uses plan marks only', async () => {
    const csv = ['階,部材,符号,数量', '2F,,Hb30,4', '3F,,G58,8', '1F,,V25,6'].join('\n');
    const r = await svc.parseBuffer(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(r.rows.length).toBe(3);
    expect(r.rows[0].elementType).toBe('taifubari');
    expect(r.rows[1].elementType).toBe('oobari');
    expect(r.rows[2].elementType).toBe('brace');
  });

  it('parses a Japanese-header CSV', async () => {
    const csv = [
      '階,工区,部材,符号,断面,数量,通り芯,備考',
      '2F,A,大梁,G1,H-600x200x11x17,8,X1-X8,',
      '2F,A,小梁,b1,H-450x200x9x14,12,,',
      '1F,A,柱,C1,H-400x400x13x21,12,X1-Y3,',
    ].join('\n');
    const buf = Buffer.from(csv, 'utf-8');
    const r = await svc.parseBuffer(buf, 'list.csv');
    expect(r.rows.length).toBe(3);
    expect(r.rows[0].elementType).toBe('oobari');
    expect(r.rows[0].label).toBe('G1');
    expect(r.rows[0].qty).toBe(8);
    expect(r.rows[0].pieceLengthMm).toBeNull();
    expect(r.rows[0].lineKind).toBe('member');
    expect(r.rows[1].elementType).toBe('kobari');
    expect(r.rows[2].elementType).toBe('hashira');
  });

  it('parses an English-header CSV', async () => {
    const csv = ['level,block,type,mark,section,qty', '3F,B,column,C2,H-400x400,4'].join('\n');
    const r = await svc.parseBuffer(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(r.rows[0].elementType).toBe('hashira');
    expect(r.rows[0].block).toBe('B');
    expect(r.rows[0].qty).toBe(4);
  });

  it('returns warnings for unknown element types', async () => {
    const csv = ['階,部材,数量', '2F,フレーム,3'].join('\n');
    const r = await svc.parseBuffer(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(r.rows.length).toBe(0);
    expect(r.warnings.some((w) => w.includes('unknown element type'))).toBe(true);
  });

  it('normalises level labels', async () => {
    const csv = ['階,部材,数量', '1,柱,12', 'R,柱,4'].join('\n');
    const r = await svc.parseBuffer(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(r.rows[0].level).toBe('1F');
    expect(r.rows[1].level).toBe('R');
  });

  it('parses optional piece length column (mm)', async () => {
    const csv = ['階,部材,断面,長さ(mm),数量', '2F,大梁,H-600x200x11x17,6000,4'].join('\n');
    const r = await svc.parseBuffer(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].elementType).toBe('oobari');
    expect(r.rows[0].pieceLengthMm).toBe(6000);
    expect(r.rows[0].qty).toBe(4);
  });

  it('rejects rows with no header for required fields', async () => {
    const csv = ['hello,world', '2F,foo'].join('\n');
    const r = await svc.parseBuffer(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(r.rows.length).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
