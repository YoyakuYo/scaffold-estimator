import { Injectable, Logger } from '@nestjs/common';
import { AiService } from './ai.service';

export interface AnomalyWarning {
  /** Severity: 'critical' | 'warning' | 'info' */
  severity: 'critical' | 'warning' | 'info';
  /** Component affected */
  component: string;
  /** Warning message in Japanese */
  messageJa: string;
  /** Warning message in English */
  messageEn: string;
  /** Suggested fix */
  suggestion: string;
}

export interface AnomalyDetectionResult {
  /** Whether detection ran successfully */
  success: boolean;
  /** Total number of anomalies found */
  totalAnomalies: number;
  /** Critical issues that likely indicate errors */
  critical: AnomalyWarning[];
  /** Warnings that should be reviewed */
  warnings: AnomalyWarning[];
  /** Informational notes */
  info: AnomalyWarning[];
  /** Overall assessment */
  overallAssessment: string;
  /** Error message if detection failed */
  error: string | null;
}

/**
 * Industry benchmarks for scaffold components per m² of scaffold area.
 * Used for rule-based anomaly detection (no AI needed for basic checks).
 */
const BENCHMARKS = {
  kusabi: {
    // Per m² of scaffold face area (one side)
    jackBase: { min: 0.3, max: 1.5, unit: '個/m²' },
    post: { min: 0.5, max: 3.0, unit: '本/m²' },
    brace: { min: 0.3, max: 1.5, unit: '本/m²' },
    plank: { min: 0.3, max: 1.2, unit: '枚/m²' },
    handrail: { min: 0.3, max: 2.0, unit: '本/m²' },
    toeBoard: { min: 0.3, max: 2.0, unit: '枚/m²' },
    // Weight per m² of scaffold area
    weightPerSqm: { min: 15, max: 40, unit: 'kg/m²' },
  },
  wakugumi: {
    frame: { min: 0.3, max: 1.5, unit: '枠/m²' },
    brace: { min: 0.5, max: 2.5, unit: '本/m²' },
    plank: { min: 0.3, max: 1.2, unit: '枚/m²' },
    weightPerSqm: { min: 20, max: 50, unit: 'kg/m²' },
  },
};

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(private aiService: AiService) {}

  /**
   * Run anomaly detection on calculated scaffold quantities.
   * Uses a combination of rule-based checks and AI analysis.
   */
  async detectAnomalies(
    config: {
      scaffoldType: 'kusabi' | 'wakugumi';
      buildingHeightMm: number;
      scaffoldWidthMm: number;
      walls: Array<{
        side: string;
        wallLengthMm: number;
        wallHeightMm: number;
        enabled: boolean;
        stairAccessCount: number;
      }>;
    },
    quantities: Array<{
      componentType: string;
      componentName: string;
      sizeSpec: string;
      calculatedQuantity: number;
      adjustedQuantity?: number;
      unit: string;
    }>,
    calculationResult?: any,
  ): Promise<AnomalyDetectionResult> {
    const result: AnomalyDetectionResult = {
      success: true,
      totalAnomalies: 0,
      critical: [],
      warnings: [],
      info: [],
      overallAssessment: '',
      error: null,
    };

    try {
      // ── 1. Rule-based checks (always run, no AI needed) ──
      this.runRuleBasedChecks(config, quantities, result);

      // ── 2. AI-powered analysis (if available) ──
      if (this.aiService.isAvailable()) {
        await this.runAiAnalysis(config, quantities, calculationResult, result);
      }

      // ── 3. Generate overall assessment ──
      result.totalAnomalies = result.critical.length + result.warnings.length + result.info.length;
      result.overallAssessment = this.generateAssessment(result);

    } catch (error) {
      this.logger.error(`Anomaly detection failed: ${error.message}`, error.stack);
      result.success = false;
      result.error = error.message;
    }

    return result;
  }

  /**
   * Rule-based anomaly detection — runs without AI.
   */
  private runRuleBasedChecks(
    config: any,
    quantities: any[],
    result: AnomalyDetectionResult,
  ): void {
    const enabledWalls = config.walls.filter((w: any) => w.enabled);

    // Check 1: No walls enabled
    if (enabledWalls.length === 0) {
      result.critical.push({
        severity: 'critical',
        component: 'walls',
        messageJa: '有効な壁面がありません。少なくとも1面を有効にしてください。',
        messageEn: 'No walls are enabled. Enable at least one wall.',
        suggestion: '壁面設定を確認してください。',
      });
    }

    // Check 2: Building height sanity
    if (config.buildingHeightMm < 2000) {
      result.warnings.push({
        severity: 'warning',
        component: 'buildingHeight',
        messageJa: `建物高さ (${config.buildingHeightMm}mm) が非常に低いです。入力値を確認してください。`,
        messageEn: `Building height (${config.buildingHeightMm}mm) is very low. Please verify.`,
        suggestion: '一般的な建物高さは3,000mm以上です。',
      });
    } else if (config.buildingHeightMm > 50000) {
      result.warnings.push({
        severity: 'warning',
        component: 'buildingHeight',
        messageJa: `建物高さ (${config.buildingHeightMm}mm) が非常に高いです。超高層建築の場合は特殊な足場が必要です。`,
        messageEn: `Building height (${config.buildingHeightMm}mm) is very tall. Special scaffolding may be needed.`,
        suggestion: '50m超の建物には特殊な安全対策が必要です。',
      });
    }

    // Check 3: Wall length sanity
    for (const wall of enabledWalls) {
      if (wall.wallLengthMm < 1000) {
        result.warnings.push({
          severity: 'warning',
          component: `wall_${wall.side}`,
          messageJa: `${wall.side}面の壁長さ (${wall.wallLengthMm}mm) が1m未満です。入力値を確認してください。`,
          messageEn: `${wall.side} wall length (${wall.wallLengthMm}mm) is less than 1m. Please verify.`,
          suggestion: '壁の長さが正しいか確認してください。',
        });
      }
      if (wall.wallLengthMm > 200000) {
        result.warnings.push({
          severity: 'warning',
          component: `wall_${wall.side}`,
          messageJa: `${wall.side}面の壁長さ (${wall.wallLengthMm}mm) が200mを超えています。`,
          messageEn: `${wall.side} wall length (${wall.wallLengthMm}mm) exceeds 200m.`,
          suggestion: '大規模建築の場合は壁面を分割することを推奨します。',
        });
      }
    }

    // Check 4: Stair access for multi-story buildings
    const totalHeight = config.buildingHeightMm;
    const totalStairs = enabledWalls.reduce((sum: number, w: any) => sum + (w.stairAccessCount || 0), 0);
    if (totalHeight > 5000 && totalStairs === 0) {
      result.warnings.push({
        severity: 'warning',
        component: 'stairAccess',
        messageJa: `建物高さ ${totalHeight}mm に対して階段セットが0です。安全のため最低1セットの階段が必要です。`,
        messageEn: `No stair access for ${totalHeight}mm building height. At least 1 stair set is recommended for safety.`,
        suggestion: '労働安全衛生法により、高所作業では昇降設備が必要です。',
      });
    }

    // Check 5: Scaffold width for stair access
    if (totalStairs > 0 && config.scaffoldWidthMm < 900) {
      result.critical.push({
        severity: 'critical',
        component: 'scaffoldWidth',
        messageJa: `足場幅 ${config.scaffoldWidthMm}mm では階段セットを設置できません。900mm以上が必要です。`,
        messageEn: `Scaffold width ${config.scaffoldWidthMm}mm is too narrow for stair sets. Minimum 900mm required.`,
        suggestion: '足場幅を900mm以上に変更してください。',
      });
    }

    // Check 6: Zero quantities
    const zeroQty = quantities.filter(q => (q.adjustedQuantity ?? q.calculatedQuantity) === 0);
    if (zeroQty.length > 0) {
      for (const q of zeroQty) {
        result.info.push({
          severity: 'info',
          component: q.componentType,
          messageJa: `${q.componentName} の数量が0です。`,
          messageEn: `${q.componentName} quantity is 0.`,
          suggestion: '意図的な場合は問題ありません。',
        });
      }
    }

    // Check 7: Calculate scaffold area and check density
    const scaffoldAreaSqm = enabledWalls.reduce(
      (sum: number, w: any) => sum + (w.wallLengthMm * w.wallHeightMm) / 1_000_000,
      0,
    );

    if (scaffoldAreaSqm > 0) {
      const totalQty = quantities.reduce(
        (sum, q) => sum + (q.adjustedQuantity ?? q.calculatedQuantity),
        0,
      );
      const densityPerSqm = totalQty / scaffoldAreaSqm;

      if (densityPerSqm > 20) {
        result.warnings.push({
          severity: 'warning',
          component: 'overall_density',
          messageJa: `部材密度 (${densityPerSqm.toFixed(1)}個/m²) が通常より高いです。壁面の寸法を確認してください。`,
          messageEn: `Component density (${densityPerSqm.toFixed(1)}/m²) is higher than typical. Verify wall dimensions.`,
          suggestion: '壁の長さや高さの入力ミスがないか確認してください。',
        });
      }
    }
  }

  /**
   * AI-powered anomaly analysis for more nuanced checks.
   */
  private async runAiAnalysis(
    config: any,
    quantities: any[],
    calculationResult: any,
    result: AnomalyDetectionResult,
  ): Promise<void> {
    try {
      const quantitySummary = quantities.map(q => ({
        name: q.componentName,
        spec: q.sizeSpec,
        qty: q.adjustedQuantity ?? q.calculatedQuantity,
        unit: q.unit,
      }));

      const enabledWalls = config.walls.filter((w: any) => w.enabled);

      const response = await this.aiService.client.chat.completions.create({
        model: this.aiService.getModel(),
        max_tokens: 1000,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `You are a scaffold estimation quality reviewer for Japanese construction.
Review the quantities and flag any anomalies. Focus on:
1. Unusually high or low quantities relative to building size
2. Missing essential components
3. Ratio imbalances between related components
4. Safety concerns

Return ONLY valid JSON array of warnings:
[
  {
    "severity": "critical" | "warning" | "info",
    "component": "string",
    "messageJa": "Japanese message",
    "messageEn": "English message",
    "suggestion": "fix suggestion in Japanese"
  }
]
Return empty array [] if no issues found.`,
          },
          {
            role: 'user',
            content: `Scaffold config:
- Type: ${config.scaffoldType}
- Building height: ${config.buildingHeightMm}mm
- Scaffold width: ${config.scaffoldWidthMm}mm
- Walls: ${JSON.stringify(enabledWalls.map((w: any) => ({ side: w.side, length: w.wallLengthMm, height: w.wallHeightMm, stairs: w.stairAccessCount })))}

Quantities:
${JSON.stringify(quantitySummary, null, 2)}

Review these quantities and flag any anomalies.`,
          },
        ],
      });

      const rawText = response.choices[0]?.message?.content || '[]';
      let jsonStr = rawText;
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const aiWarnings: AnomalyWarning[] = JSON.parse(jsonStr);
      
      for (const w of aiWarnings) {
        if (w.severity === 'critical') result.critical.push(w);
        else if (w.severity === 'warning') result.warnings.push(w);
        else result.info.push(w);
      }

      this.logger.log(`AI anomaly detection found ${aiWarnings.length} additional issues`);
    } catch (error) {
      this.logger.warn(`AI anomaly analysis failed (rule-based checks still apply): ${error.message}`);
    }
  }

  private generateAssessment(result: AnomalyDetectionResult): string {
    if (result.critical.length > 0) {
      return `⚠️ ${result.critical.length}件の重大な問題が見つかりました。見積もりを確定する前に修正してください。`;
    }
    if (result.warnings.length > 0) {
      return `⚡ ${result.warnings.length}件の注意事項があります。確認することを推奨します。`;
    }
    if (result.info.length > 0) {
      return `✅ 重大な問題はありません。${result.info.length}件の情報があります。`;
    }
    return '✅ 問題は検出されませんでした。見積もりは正常です。';
  }
}
