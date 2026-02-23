import apiClient from './client';

// ─── Types ──────────────────────────────────────────────────

export interface VisionAnalysisResult {
  success: boolean;
  buildingShape: string;
  buildingHeightMm: number | null;
  floorCount: number | null;
  structureType: '改修工事' | 'S造' | 'RC造' | null;
  walls: Array<{
    side: string;
    lengthMm: number | null;
    heightMm: number | null;
  }>;
  drawingType: string;
  scale: string | null;
  confidence: number;
  notes: string;
  rawResponse: string;
  error: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

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
      language: 'ja' | 'en';
      steps: Array<{
        key: string;
        label: string;
        options: Array<{ value: string | number; label: string }>;
      }>;
    };
  };
}

export interface ChatResponse {
  message: string;
  suggestedAction: ScaffoldAction | null;
}

export interface AnomalyWarning {
  severity: 'critical' | 'warning' | 'info';
  component: string;
  messageJa: string;
  messageEn: string;
  suggestion: string;
}

export interface AnomalyDetectionResult {
  success: boolean;
  totalAnomalies: number;
  critical: AnomalyWarning[];
  warnings: AnomalyWarning[];
  info: AnomalyWarning[];
  overallAssessment: string;
  error: string | null;
}

export interface AiStatus {
  available: boolean;
  model: string | null;
  features: {
    vision: boolean;
    chat: boolean;
    anomalyDetection: boolean;
  };
}

// ─── API Client ─────────────────────────────────────────────

export const aiApi = {
  /** Check AI service status */
  getStatus: async (): Promise<AiStatus> => {
    const res = await apiClient.get<AiStatus>('/ai/status');
    return res.data;
  },

  /** Analyze a drawing image (base64) with GPT-4o Vision */
  analyzeDrawing: async (base64Image: string, mimeType?: string): Promise<VisionAnalysisResult> => {
    const res = await apiClient.post<VisionAnalysisResult>('/ai/vision/analyze', {
      image: base64Image,
      mimeType: mimeType || 'image/jpeg',
    });
    return res.data;
  },

  /** Analyze a drawing file upload with OpenAI Vision */
  analyzeDrawingFile: async (file: File): Promise<VisionAnalysisResult> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiClient.post<VisionAnalysisResult>('/ai/vision/analyze-file', formData);
    return res.data;
  },

  /** Chat with the AI scaffold estimation assistant */
  chat: async (
    message: string,
    history?: ChatMessage[],
    currentConfigId?: string,
  ): Promise<ChatResponse> => {
    const res = await apiClient.post<ChatResponse>('/ai/chat', {
      message,
      history,
      currentConfigId,
    });
    return res.data;
  },

  /** Run anomaly detection on a scaffold configuration */
  detectAnomalies: async (configId: string): Promise<AnomalyDetectionResult> => {
    const res = await apiClient.post<AnomalyDetectionResult>('/ai/anomaly-detect', {
      configId,
    });
    return res.data;
  },
};
