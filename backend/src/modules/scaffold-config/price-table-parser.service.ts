import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ScaffoldMaterial } from './scaffold-material.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

export interface PriceMapping {
  materialName?: string;
  materialCode?: string;
  sizeSpec?: string;
  price: number;
  rowNumber?: number;
  source: string; // Original text from file
}

export interface MatchedPrice {
  material: ScaffoldMaterial;
  newPrice: number;
  oldPrice: number;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  matchReason: string;
}

@Injectable()
export class PriceTableParserService {
  private readonly logger = new Logger(PriceTableParserService.name);

  constructor(
    @InjectRepository(ScaffoldMaterial)
    private materialRepo: Repository<ScaffoldMaterial>,
  ) {}

  /**
   * Parse Excel file and extract price mappings
   */
  async parseExcel(file: Express.Multer.File): Promise<PriceMapping[]> {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file.path);

      const mappings: PriceMapping[] = [];

      // Try each worksheet
      for (const worksheet of workbook.worksheets) {
        this.logger.log(`Parsing worksheet: ${worksheet.name}`);

        // Find header row (look for common column names)
        let headerRow = 1;
        let nameCol = -1;
        let codeCol = -1;
        let sizeCol = -1;
        let priceCol = -1;

        // Scan first 5 rows for headers
        for (let row = 1; row <= Math.min(5, worksheet.rowCount); row++) {
          const rowData = worksheet.getRow(row);
          for (let col = 1; col <= worksheet.columnCount; col++) {
            const cellValue = String(rowData.getCell(col).value || '').toLowerCase();
            
            // Match common column names
            if (cellValue.includes('部材') || cellValue.includes('material') || cellValue.includes('name') || cellValue.includes('名称')) {
              nameCol = col;
              headerRow = row;
            }
            if (cellValue.includes('code') || cellValue.includes('コード') || cellValue.includes('品番')) {
              codeCol = col;
              headerRow = row;
            }
            if (cellValue.includes('size') || cellValue.includes('サイズ') || cellValue.includes('規格') || cellValue.includes('spec')) {
              sizeCol = col;
              headerRow = row;
            }
            if (cellValue.includes('price') || cellValue.includes('単価') || cellValue.includes('価格') || cellValue.includes('金額') || cellValue.includes('月額')) {
              priceCol = col;
              headerRow = row;
            }
          }
        }

        // If no headers found, assume first row is header and try common positions
        if (nameCol === -1 && codeCol === -1) {
          nameCol = 1; // Assume first column is name
          priceCol = -1;
          // Try to find price column (usually last or second-to-last)
          for (let col = worksheet.columnCount; col >= 1; col--) {
            const cellValue = String(worksheet.getRow(headerRow).getCell(col).value || '');
            if (!isNaN(Number(cellValue)) && Number(cellValue) > 0) {
              priceCol = col;
              break;
            }
          }
        }

        if (priceCol === -1) {
          this.logger.warn(`No price column found in worksheet ${worksheet.name}, skipping`);
          continue;
        }

        // Parse data rows
        for (let row = headerRow + 1; row <= worksheet.rowCount; row++) {
          const rowData = worksheet.getRow(row);
          
          // Get material name/code
          let materialName = '';
          let materialCode = '';
          let sizeSpec = '';

          if (nameCol > 0) {
            materialName = String(rowData.getCell(nameCol).value || '').trim();
          }
          if (codeCol > 0) {
            materialCode = String(rowData.getCell(codeCol).value || '').trim();
          }
          if (sizeCol > 0) {
            sizeSpec = String(rowData.getCell(sizeCol).value || '').trim();
          }

          // Get price
          const priceValue = rowData.getCell(priceCol).value;
          let price = 0;
          
          if (typeof priceValue === 'number') {
            price = priceValue;
          } else if (typeof priceValue === 'string') {
            // Remove currency symbols and commas
            const cleaned = priceValue.replace(/[¥,\s]/g, '');
            price = parseFloat(cleaned) || 0;
          }

          // Skip empty rows
          if (!materialName && !materialCode && price === 0) {
            continue;
          }

          // Skip if price is 0 or invalid
          if (price <= 0 || price > 1000000) {
            continue;
          }

          mappings.push({
            materialName: materialName || undefined,
            materialCode: materialCode || undefined,
            sizeSpec: sizeSpec || undefined,
            price: Math.round(price),
            rowNumber: row,
            source: `${worksheet.name}:${row}`,
          });
        }
      }

      this.logger.log(`Parsed ${mappings.length} price mappings from Excel`);
      return mappings;
    } catch (error) {
      this.logger.error(`Excel parsing failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to parse Excel file: ${error.message}`);
    }
  }

  /**
   * Match uploaded prices to material master
   */
  async matchToMaterials(mappings: PriceMapping[]): Promise<MatchedPrice[]> {
    // Load all materials
    const allMaterials = await this.materialRepo.find({
      where: { scaffoldType: 'kusabi', isActive: true },
    });

    const matched: MatchedPrice[] = [];

    for (const mapping of mappings) {
      let bestMatch: ScaffoldMaterial | null = null;
      let bestConfidence: 'exact' | 'high' | 'medium' | 'low' = 'low';
      let matchReason = '';

      // Try exact code match first
      if (mapping.materialCode) {
        const exactCodeMatch = allMaterials.find(
          (m) => m.code.toLowerCase() === mapping.materialCode!.toLowerCase(),
        );
        if (exactCodeMatch) {
          bestMatch = exactCodeMatch;
          bestConfidence = 'exact';
          matchReason = `Exact code match: ${mapping.materialCode}`;
        }
      }

      // Try name + size match
      if (!bestMatch && mapping.materialName) {
        const nameLower = mapping.materialName.toLowerCase();
        
        for (const material of allMaterials) {
          const materialNameLower = material.nameJp.toLowerCase();
          
          // Exact name match
          if (materialNameLower === nameLower || materialNameLower.includes(nameLower) || nameLower.includes(materialNameLower)) {
            // If size spec provided, try to match it
            if (mapping.sizeSpec) {
              const sizeMatch = this.matchSizeSpec(mapping.sizeSpec, material.sizeSpec);
              if (sizeMatch) {
                if (!bestMatch || bestConfidence === 'low') {
                  bestMatch = material;
                  bestConfidence = sizeMatch ? 'high' : 'medium';
                  matchReason = `Name + size match: ${mapping.materialName} + ${mapping.sizeSpec}`;
                }
              }
            } else {
              // Name match without size - lower confidence
              if (!bestMatch || bestConfidence === 'low') {
                bestMatch = material;
                bestConfidence = 'medium';
                matchReason = `Name match: ${mapping.materialName}`;
              }
            }
          }
        }
      }

      // Try partial name match (contains key words)
      if (!bestMatch && mapping.materialName) {
        const keywords = this.extractKeywords(mapping.materialName);
        
        for (const material of allMaterials) {
          const materialKeywords = this.extractKeywords(material.nameJp);
          const commonKeywords = keywords.filter((k) => materialKeywords.includes(k));
          
          if (commonKeywords.length >= 2) {
            // If size spec matches, it's a good match
            if (mapping.sizeSpec && this.matchSizeSpec(mapping.sizeSpec, material.sizeSpec)) {
              bestMatch = material;
              bestConfidence = 'high';
              matchReason = `Keyword + size match: ${commonKeywords.join(', ')} + ${mapping.sizeSpec}`;
              break;
            } else if (!bestMatch) {
              bestMatch = material;
              bestConfidence = 'medium';
              matchReason = `Keyword match: ${commonKeywords.join(', ')}`;
            }
          }
        }
      }

      if (bestMatch) {
        matched.push({
          material: bestMatch,
          newPrice: mapping.price,
          oldPrice: Number(bestMatch.rentalPriceMonthly),
          confidence: bestConfidence,
          matchReason,
        });
      }
    }

    this.logger.log(`Matched ${matched.length}/${mappings.length} prices to materials`);
    return matched;
  }

  /**
   * Extract keywords from material name (Japanese)
   */
  private extractKeywords(name: string): string[] {
    const keywords: string[] = [];
    
    // Common Japanese scaffold terms
    const terms = ['支柱', 'ブレス', '手摺', '踏板', '巾木', '根がらみ', '階段', 'ジャッキ', 'MA-18', 'MA-27', 'MA-36', 'MA-9', 'MA-13'];
    
    for (const term of terms) {
      if (name.includes(term)) {
        keywords.push(term);
      }
    }
    
    // Extract numbers (sizes)
    const numbers = name.match(/\d+/g);
    if (numbers) {
      keywords.push(...(numbers as string[]));
    }
    
    return keywords;
  }

  /**
   * Match size specifications
   */
  private matchSizeSpec(uploaded: string, material: string): boolean {
    // Normalize both
    const uploadedNorm = uploaded.toLowerCase().replace(/\s/g, '');
    const materialNorm = material.toLowerCase().replace(/\s/g, '');
    
    // Exact match
    if (uploadedNorm === materialNorm) {
      return true;
    }
    
    // Extract numbers and compare
    const uploadedNums = (uploadedNorm.match(/\d+/g) || []) as string[];
    const materialNums = (materialNorm.match(/\d+/g) || []) as string[];
    
    if (uploadedNums.length > 0 && materialNums.length > 0) {
      // Check if any numbers match
      return uploadedNums.some((n) => materialNums.includes(n));
    }
    
    return false;
  }
}
