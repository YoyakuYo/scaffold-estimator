import { Injectable, Logger } from '@nestjs/common';
import { AiService } from './ai.service';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  message: string;
  /** If the AI suggests creating/updating a scaffold config, this contains the structured data */
  suggestedAction: ScaffoldAction | null;
}

type Language = 'ja' | 'en';

export interface ScaffoldAction {
  type: 'create_config' | 'update_config' | 'explain' | 'compare';
  data: {
    buildingHeightMm?: number;
    scaffoldWidthMm?: number;
    scaffoldType?: 'kusabi' | 'wakugumi';
    structureType?: '改修工事' | 'S造' | 'RC造';
    preferredMainTatejiMm?: number;
    topGuardHeightMm?: number;
    frameSizeMm?: number;
    walls?: Array<{
      side: string;
      wallLengthMm: number;
      wallHeightMm: number;
      enabled: boolean;
      stairAccessCount: number;
    }>;
    guidedSelections?: {
      language: Language;
      steps: Array<{
        key: string;
        label: string;
        options: Array<{ value: string | number; label: string }>;
      }>;
    };
  };
}

@Injectable()
export class ChatAssistantService {
  private readonly logger = new Logger(ChatAssistantService.name);

  constructor(private aiService: AiService) {}

  /**
   * Process a chat message from the user and return an AI response.
   * The AI understands scaffold estimation domain and can suggest actions.
   */
  async chat(
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
    context?: {
      currentConfig?: any;
      recentConfigs?: any[];
    },
  ): Promise<ChatResponse> {
    const language = this.detectLanguage(userMessage);
    if (!this.aiService.isAvailable()) {
      return {
        message:
          language === 'en'
            ? 'AI features are currently unavailable. Please set OPENAI_API_KEY in your .env file.'
            : 'AI機能は現在利用できません。環境変数 OPENAI_API_KEY を設定してください。',
        suggestedAction: null,
      };
    }

    try {
      const systemPrompt = this.buildSystemPrompt(context, language);
      
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: userMessage },
      ];

      const response = await this.aiService.client.chat.completions.create({
        model: this.aiService.getModel(),
        max_tokens: 1500,
        temperature: 0.3,
        messages,
      });

      const rawText = response.choices[0]?.message?.content || '';
      this.logger.log(`Chat response received (${rawText.length} chars)`);

      // Try to extract structured action from the response
      const suggestedAction = this.enrichAction(this.extractAction(rawText), language);

      // Clean the message (remove JSON blocks if action was extracted)
      let cleanMessage = rawText;
      if (suggestedAction) {
        cleanMessage = rawText.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '').trim();
        if (!cleanMessage) {
          cleanMessage = this.generateActionSummary(suggestedAction);
        }
      }

      return {
        message: cleanMessage,
        suggestedAction,
      };
    } catch (error) {
      this.logger.error(`Chat failed: ${error.message}`, error.stack);
      return {
        message:
          language === 'en'
            ? `An error occurred: ${error.message}`
            : `エラーが発生しました: ${error.message}`,
        suggestedAction: null,
      };
    }
  }

  private detectLanguage(text: string): Language {
    return /[\u3040-\u30ff\u3400-\u9faf]/.test(text) ? 'ja' : 'en';
  }

  private buildSystemPrompt(context?: { currentConfig?: any; recentConfigs?: any[] }, language: Language = 'ja'): string {
    const languageInstruction =
      language === 'en'
        ? 'Respond ONLY in English. Do not include Japanese.'
        : '日本語で応答してください。ユーザーが英語なら英語で応答してください。';

    let prompt = `あなたは日本の建設現場で使用される足場（仮設工事）の見積もりを支援するAIアシスタントです。
ユーザーは足場の積算を行う専門家です。日本語と英語の両方で対応できます。
${languageInstruction}

## 足場の種類
1. **くさび式足場 (kusabi)**: 支柱サイズ MA-18(1800mm), MA-27(2700mm), MA-36(3600mm)。スパン: 600, 900, 1200, 1500, 1800mm。レベル高さ: 常に1800mm固定。
2. **枠組足場 (wakugumi)**: 建枠サイズ 1700, 1800, 1900mm。スパン: 610, 914, 1219, 1524, 1829mm。レベル高さ = 建枠サイズ。

## 足場幅
600mm, 900mm, 1200mm のみ

## 構造パターン
- 改修工事: 最も複雑
- S造: 中程度
- RC造: 最もシンプル

## あなたの役割
- ユーザーの質問に答える
- 建物の説明から足場の設定を提案する
- 見積もりの比較や説明を行う
- 足場の安全基準について助言する

## 応答ルール
1. 言語はユーザー入力に合わせる（英語質問なら英語、日本語質問なら日本語）
2. 足場の設定を提案する場合は、以下のJSON形式でアクションを含める:
\`\`\`json
{
  "type": "create_config",
  "data": {
    "buildingHeightMm": number,
    "scaffoldWidthMm": number,
    "scaffoldType": "kusabi" | "wakugumi",
    "structureType": "改修工事" | "S造" | "RC造",
    "walls": [
      { "side": "north", "wallLengthMm": number, "wallHeightMm": number, "enabled": true, "stairAccessCount": 0 }
    ]
  }
}
\`\`\`
3. JSONを返すときは必ず本文説明の後に1つのJSONブロックだけ出力する
4. ユーザーが「選択肢」を求める場合、scaffoldType / scaffoldWidthMm / structureType / post or frame に推奨値を入れる
3. 数値は常にミリメートルで表示する
4. 不明な情報がある場合は、一般的なデフォルト値を使用し、その旨を伝える`;

    if (context?.currentConfig) {
      prompt += `\n\n## 現在の設定\n${JSON.stringify(context.currentConfig, null, 2)}`;
    }

    if (context?.recentConfigs && context.recentConfigs.length > 0) {
      prompt += `\n\n## 最近の設定 (${context.recentConfigs.length}件)\n`;
      for (const cfg of context.recentConfigs.slice(0, 3)) {
        prompt += `- 建物高さ: ${cfg.buildingHeightMm}mm, 足場幅: ${cfg.scaffoldWidthMm}mm, タイプ: ${cfg.scaffoldType || 'kusabi'}\n`;
      }
    }

    return prompt;
  }

  private extractAction(text: string): ScaffoldAction | null {
    try {
      const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.type && parsed.data) {
        return parsed as ScaffoldAction;
      }
      return null;
    } catch {
      return null;
    }
  }

  private enrichAction(action: ScaffoldAction | null, language: Language): ScaffoldAction | null {
    if (!action || action.type !== 'create_config') return action;

    const data = action.data || {};
    const scaffoldType = data.scaffoldType || 'kusabi';
    const width = data.scaffoldWidthMm || 900;
    const structureType = data.structureType || '改修工事';

    const baseSteps = [
      {
        key: 'scaffoldType',
        label: language === 'en' ? 'Select scaffold type' : '足場タイプを選択',
        options: [
          { value: 'kusabi', label: language === 'en' ? 'Kusabi (Wedge)' : 'くさび式' },
          { value: 'wakugumi', label: language === 'en' ? 'Wakugumi (Frame)' : '枠組' },
        ],
      },
      {
        key: 'scaffoldWidthMm',
        label: language === 'en' ? 'Select scaffold width' : '足場幅を選択',
        options: [600, 900, 1200].map((v) => ({ value: v, label: `${v}mm` })),
      },
      {
        key: 'structureType',
        label: language === 'en' ? 'Select structure type' : '構造種別を選択',
        options: [
          { value: '改修工事', label: language === 'en' ? 'Renovation' : '改修工事' },
          { value: 'S造', label: 'S造' },
          { value: 'RC造', label: 'RC造' },
        ],
      },
    ];

    const typeSpecific =
      scaffoldType === 'wakugumi'
        ? [
            {
              key: 'frameSizeMm',
              label: language === 'en' ? 'Select frame size' : '建枠サイズを選択',
              options: [1700, 1800, 1900].map((v) => ({ value: v, label: `${v}mm` })),
            },
          ]
        : [
            {
              key: 'preferredMainTatejiMm',
              label: language === 'en' ? 'Select post size' : '支柱サイズを選択',
              options: [1800, 2700, 3600].map((v) => ({ value: v, label: `${v}mm` })),
            },
            {
              key: 'topGuardHeightMm',
              label: language === 'en' ? 'Select top guard height' : '上部支柱を選択',
              options: [900, 1350, 1800].map((v) => ({ value: v, label: `${v}mm` })),
            },
          ];

    return {
      ...action,
      data: {
        ...data,
        scaffoldType,
        scaffoldWidthMm: width,
        structureType,
        preferredMainTatejiMm: data.preferredMainTatejiMm || 1800,
        topGuardHeightMm: data.topGuardHeightMm || 900,
        frameSizeMm: data.frameSizeMm || 1700,
        guidedSelections: {
          language,
          steps: [...baseSteps, ...typeSpecific],
        },
      },
    };
  }

  private generateActionSummary(action: ScaffoldAction): string {
    if (action.type === 'create_config') {
      const d = action.data;
      const language = d.guidedSelections?.language || 'ja';
      let summary =
        language === 'en'
          ? 'I recommend creating a scaffold configuration with the following settings:\n\n'
          : '以下の設定で足場の見積もりを作成することを提案します：\n\n';
      if (d.buildingHeightMm) summary += language === 'en' ? `• Building height: ${d.buildingHeightMm.toLocaleString()}mm\n` : `• 建物高さ: ${d.buildingHeightMm.toLocaleString()}mm\n`;
      if (d.scaffoldWidthMm) summary += language === 'en' ? `• Scaffold width: ${d.scaffoldWidthMm}mm\n` : `• 足場幅: ${d.scaffoldWidthMm}mm\n`;
      if (d.scaffoldType) summary += language === 'en' ? `• Scaffold type: ${d.scaffoldType === 'kusabi' ? 'Kusabi' : 'Wakugumi'}\n` : `• 足場タイプ: ${d.scaffoldType === 'kusabi' ? 'くさび式' : '枠組'}\n`;
      if (d.structureType) summary += language === 'en' ? `• Structure: ${d.structureType}\n` : `• 構造: ${d.structureType}\n`;
      if (d.walls) {
        summary += language === 'en' ? `• Walls: ${d.walls.length}\n` : `• 壁: ${d.walls.length}面\n`;
        for (const w of d.walls) {
          summary += `  - ${w.side}: ${w.wallLengthMm.toLocaleString()}mm × ${w.wallHeightMm.toLocaleString()}mm\n`;
        }
      }
      summary += language === 'en' ? '\nUse the selection buttons below to adjust settings, then apply to calculator.' : '\n下の選択ボタンで調整して、計算画面へ適用してください。';
      return summary;
    }
    return 'Action suggestion generated.';
  }
}
