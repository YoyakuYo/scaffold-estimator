'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { aiApi, ChatMessage, ChatResponse, VisionAnalysisResult, AnomalyDetectionResult } from '@/lib/api/ai';
import { useI18n } from '@/lib/i18n';
import {
  Brain,
  Calculator,
  Send,
  ArrowRight,
  Upload,
  Eye,
  ShieldCheck,
  Loader2,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle,
  Info,
  X,
  Bot,
  User,
  Sparkles,
  FileImage,
  Zap,
} from 'lucide-react';

type Tab = 'chat' | 'vision' | 'anomaly';

export default function AiPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>}>
      <AiPage />
    </Suspense>
  );
}

function AiPage() {
  const { locale } = useI18n();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(tabParam && ['chat', 'vision', 'anomaly'].includes(tabParam) ? tabParam : 'chat');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Brain className="h-8 w-8 text-purple-600" />
            {locale === 'ja' ? 'AI アシスタント' : 'AI Assistant'}
          </h1>
          <p className="text-gray-500 mt-1">
            {locale === 'ja'
              ? 'AIを活用した図面読取り、チャット見積もり、品質チェック'
              : 'AI-powered drawing analysis, chat estimation, and quality review'}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          {[
            { id: 'chat' as Tab, icon: Bot, label: locale === 'ja' ? 'チャット見積もり' : 'Chat Estimator', color: 'blue' },
            { id: 'vision' as Tab, icon: Eye, label: locale === 'ja' ? '図面AI読取り' : 'Drawing Vision AI', color: 'purple' },
            { id: 'anomaly' as Tab, icon: ShieldCheck, label: locale === 'ja' ? '品質チェック' : 'Quality Review', color: 'green' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
                activeTab === tab.id
                  ? `bg-${tab.color}-600 text-white shadow-md`
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'chat' && <ChatTab locale={locale} />}
        {activeTab === 'vision' && <VisionTab locale={locale} />}
        {activeTab === 'anomaly' && <AnomalyTab locale={locale} />}
      </div>
    </div>
  );
}

// ─── Chat Tab ────────────────────────────────────────────────

function ChatTab({ locale }: { locale: string }) {
  const router = useRouter();
  type ChatUiMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    suggestedAction?: ChatResponse['suggestedAction'];
    actionDraft?: Record<string, any>;
    wizardStep?: number;
  };
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const chatMutation = useMutation({
    mutationFn: (message: string) => {
      const history: ChatMessage[] = messages.map(m => ({ role: m.role, content: m.content }));
      return aiApi.chat(message, history);
    },
    onSuccess: (response: ChatResponse) => {
      setMessages(prev => [
        ...prev,
        {
          id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content: response.message,
          suggestedAction: response.suggestedAction,
          actionDraft: response.suggestedAction?.data ? { ...response.suggestedAction.data } : undefined,
          wizardStep: 0,
        },
      ]);
    },
  });

  const updateDraft = (messageId: string, key: string, value: string | number) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              actionDraft: {
                ...(m.actionDraft || m.suggestedAction?.data || {}),
                [key]: value,
              },
            }
          : m,
      ),
    );
  };

  const applyActionToCalculator = (msg: ChatUiMessage) => {
    if (!msg.suggestedAction || msg.suggestedAction.type !== 'create_config') return;
    const draft = msg.actionDraft || msg.suggestedAction.data || {};
    try {
      sessionStorage.setItem('aiScaffoldPrefill', JSON.stringify(draft));
    } catch {
      // Ignore storage errors and still navigate.
    }
    router.push('/scaffold?fromAi=1');
  };

  const setWizardStep = (messageId: string, step: number) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, wizardStep: Math.max(0, step) } : m)),
    );
  };

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;
    const userMessage = input.trim();
    setMessages(prev => [
      ...prev,
      {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: userMessage,
      },
    ]);
    setInput('');
    chatMutation.mutate(userMessage);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const quickPrompts = locale === 'ja'
    ? [
        '5階建てRC造ビルの足場を見積もりたい',
        'くさび式と枠組の違いを教えて',
        '足場幅900mmで階段2セットの設定を提案して',
        '改修工事の足場で注意すべき点は？',
      ]
    : [
        'Estimate scaffold for a 5-story RC building',
        'Compare kusabi vs wakugumi scaffolding',
        'Suggest config for 900mm width with 2 stairs',
        'Safety tips for renovation scaffolding?',
      ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col" style={{ height: '70vh' }}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Sparkles className="h-16 w-16 text-purple-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              {locale === 'ja' ? '足場見積もりAIアシスタント' : 'Scaffold Estimation AI Assistant'}
            </h3>
            <p className="text-gray-500 text-sm mb-6 max-w-md">
              {locale === 'ja'
                ? '建物の説明から足場の設定を提案したり、見積もりに関する質問に答えます。'
                : 'Describe your building and I\'ll suggest scaffold configurations, or ask any estimation question.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {quickPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInput(prompt);
                  }}
                  className="text-left px-4 py-3 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg text-sm text-gray-700 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-purple-600" />
                </div>
              )}
              <div className="max-w-[75%] space-y-2">
                <div
                  className={`px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-gray-100 text-gray-800 rounded-bl-md'
                  }`}
                >
                  {msg.content}
                </div>

                {msg.role === 'assistant' &&
                  msg.suggestedAction?.type === 'create_config' &&
                  msg.actionDraft && (
                    <div className="bg-white border border-blue-200 rounded-xl p-3 space-y-3">
                      {(() => {
                        const lang = msg.suggestedAction?.data?.guidedSelections?.language || (locale === 'ja' ? 'ja' : 'en');
                        const isEn = lang === 'en';
                        const type = (msg.actionDraft?.scaffoldType as 'kusabi' | 'wakugumi') || 'kusabi';
                        const width = Number(msg.actionDraft?.scaffoldWidthMm || 900);
                        const structure = (msg.actionDraft?.structureType as '改修工事' | 'S造' | 'RC造') || '改修工事';
                        const steps = [
                          { key: 'scaffoldType', title: isEn ? 'Select Scaffold Type' : '足場タイプを選択' },
                          { key: 'scaffoldWidthMm', title: isEn ? 'Select Width' : '足場幅を選択' },
                          { key: 'structureType', title: isEn ? 'Select Structure' : '構造種別を選択' },
                          ...(type === 'kusabi'
                            ? [
                                { key: 'preferredMainTatejiMm', title: isEn ? 'Select Post Size' : '支柱サイズを選択' },
                                { key: 'topGuardHeightMm', title: isEn ? 'Select Top Guard' : '上部支柱を選択' },
                              ]
                            : [{ key: 'frameSizeMm', title: isEn ? 'Select Frame Size' : '建枠サイズを選択' }]),
                        ];
                        const currentStep = Math.min(msg.wizardStep ?? 0, steps.length - 1);
                        const currentKey = steps[currentStep]?.key;
                        const isLastStep = currentStep === steps.length - 1;

                        return (
                          <>
                            <p className="text-xs font-semibold text-blue-700">
                              {isEn ? 'Guided Scaffold Selection' : 'ガイド付き足場選択'}
                            </p>
                            <div className="flex items-center justify-between text-xs text-gray-600">
                              <span>
                                {isEn ? 'Step' : 'ステップ'} {currentStep + 1}/{steps.length}
                              </span>
                              <span>{steps[currentStep]?.title}</span>
                            </div>
                            <div className="h-1.5 rounded bg-blue-100 overflow-hidden">
                              <div
                                className="h-full bg-blue-600 transition-all"
                                style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
                              />
                            </div>

                            {currentKey === 'scaffoldType' && (
                              <div>
                              <p className="text-xs text-gray-600 mb-1">{isEn ? 'Scaffold Type' : '足場タイプ'}</p>
                              <div className="flex gap-2">
                                {[
                                  { value: 'kusabi', label: isEn ? 'Kusabi' : 'くさび式' },
                                  { value: 'wakugumi', label: isEn ? 'Wakugumi' : '枠組' },
                                ].map((opt) => (
                                  <button
                                    key={opt.value}
                                    onClick={() => updateDraft(msg.id, 'scaffoldType', opt.value)}
                                    className={`px-3 py-1.5 text-xs rounded-lg border ${
                                      type === opt.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                              </div>
                            )}

                            {currentKey === 'scaffoldWidthMm' && (
                              <div>
                              <p className="text-xs text-gray-600 mb-1">{isEn ? 'Width' : '足場幅'}</p>
                              <div className="flex gap-2">
                                {[600, 900, 1200].map((v) => (
                                  <button
                                    key={v}
                                    onClick={() => updateDraft(msg.id, 'scaffoldWidthMm', v)}
                                    className={`px-3 py-1.5 text-xs rounded-lg border ${
                                      width === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
                                    }`}
                                  >
                                    {v}mm
                                  </button>
                                ))}
                              </div>
                              </div>
                            )}

                            {currentKey === 'structureType' && (
                              <div>
                              <p className="text-xs text-gray-600 mb-1">{isEn ? 'Structure' : '構造種別'}</p>
                              <div className="flex gap-2">
                                {['改修工事', 'S造', 'RC造'].map((v) => (
                                  <button
                                    key={v}
                                    onClick={() => updateDraft(msg.id, 'structureType', v)}
                                    className={`px-3 py-1.5 text-xs rounded-lg border ${
                                      structure === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
                                    }`}
                                  >
                                    {isEn && v === '改修工事' ? 'Renovation' : v}
                                  </button>
                                ))}
                              </div>
                              </div>
                            )}

                            {type === 'kusabi' && currentKey === 'preferredMainTatejiMm' && (
                              <div>
                                  <p className="text-xs text-gray-600 mb-1">{isEn ? 'Post Size' : '支柱サイズ'}</p>
                                  <div className="flex gap-1.5 flex-wrap">
                                    {[1800, 2700, 3600].map((v) => (
                                      <button
                                        key={v}
                                        onClick={() => updateDraft(msg.id, 'preferredMainTatejiMm', v)}
                                        className={`px-2.5 py-1 text-xs rounded border ${
                                          Number(msg.actionDraft?.preferredMainTatejiMm || 1800) === v
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
                                        }`}
                                      >
                                        {v}
                                      </button>
                                    ))}
                                  </div>
                              </div>
                            )}
                            {type === 'kusabi' && currentKey === 'topGuardHeightMm' && (
                              <div>
                                  <p className="text-xs text-gray-600 mb-1">{isEn ? 'Top Guard' : '上部支柱'}</p>
                                  <div className="flex gap-1.5 flex-wrap">
                                    {[900, 1350, 1800].map((v) => (
                                      <button
                                        key={v}
                                        onClick={() => updateDraft(msg.id, 'topGuardHeightMm', v)}
                                        className={`px-2.5 py-1 text-xs rounded border ${
                                          Number(msg.actionDraft?.topGuardHeightMm || 900) === v
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
                                        }`}
                                      >
                                        {v}
                                      </button>
                                    ))}
                                  </div>
                              </div>
                            )}
                            {type === 'wakugumi' && currentKey === 'frameSizeMm' && (
                              <div>
                                <p className="text-xs text-gray-600 mb-1">{isEn ? 'Frame Size' : '建枠サイズ'}</p>
                                <div className="flex gap-1.5 flex-wrap">
                                  {[1700, 1800, 1900].map((v) => (
                                    <button
                                      key={v}
                                      onClick={() => updateDraft(msg.id, 'frameSizeMm', v)}
                                      className={`px-2.5 py-1 text-xs rounded border ${
                                        Number(msg.actionDraft?.frameSizeMm || 1700) === v
                                          ? 'bg-blue-600 text-white border-blue-600'
                                          : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
                                      }`}
                                    >
                                      {v}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setWizardStep(msg.id, currentStep - 1)}
                                disabled={currentStep === 0}
                                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 disabled:opacity-40"
                              >
                                {isEn ? 'Back' : '戻る'}
                              </button>
                              {!isLastStep ? (
                                <button
                                  onClick={() => setWizardStep(msg.id, currentStep + 1)}
                                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                                >
                                  {isEn ? 'Next' : '次へ'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => applyActionToCalculator(msg)}
                                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                                >
                                  <Calculator className="h-4 w-4" />
                                  {isEn ? 'Apply and Open Calculator' : '適用して計算画面へ'}
                                  <ArrowRight className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                
              </div>
              {msg.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <User className="h-4 w-4 text-blue-600" />
                </div>
              )}
            </div>
          ))
        )}
        {chatMutation.isPending && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
              <Bot className="h-4 w-4 text-purple-600" />
            </div>
            <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-md">
              <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={locale === 'ja' ? '足場に関する質問を入力...' : 'Ask about scaffolding...'}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-xl resize-none focus:ring-blue-500 focus:border-blue-500 text-sm"
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending}
            className="px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Vision Tab ──────────────────────────────────────────────

function VisionTab({ locale }: { locale: string }) {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<VisionAnalysisResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyzeMutation = useMutation({
    mutationFn: (file: File) => aiApi.analyzeDrawingFile(file),
    onSuccess: (data) => setResult(data),
  });

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleAnalyze = () => {
    if (selectedFile) {
      analyzeMutation.mutate(selectedFile);
    }
  };

  const SIDE_LABELS: Record<string, string> = {
    north: locale === 'ja' ? '北面' : 'North',
    south: locale === 'ja' ? '南面' : 'South',
    east: locale === 'ja' ? '東面' : 'East',
    west: locale === 'ja' ? '西面' : 'West',
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Upload Area */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <FileImage className="h-5 w-5 text-purple-500" />
          {locale === 'ja' ? '図面アップロード' : 'Upload Drawing'}
        </h2>

        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
          {preview ? (
            <div className="space-y-3">
              <img src={preview} alt="Preview" className="max-h-64 mx-auto rounded-lg shadow-md" />
              <p className="text-sm text-gray-600">{selectedFile?.name}</p>
            </div>
          ) : (
            <>
              <Upload className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">
                {locale === 'ja' ? '図面をドロップまたはクリック' : 'Drop drawing or click to upload'}
              </p>
              <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP — max 20MB</p>
            </>
          )}
        </div>

        {selectedFile && (
          <button
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending}
            className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 font-medium"
          >
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {locale === 'ja' ? 'AI分析中...' : 'Analyzing...'}
              </>
            ) : (
              <>
                <Zap className="h-5 w-5" />
                {locale === 'ja' ? 'AI Visionで分析' : 'Analyze with AI Vision'}
              </>
            )}
          </button>
        )}
      </div>

      {/* Results */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Eye className="h-5 w-5 text-blue-500" />
          {locale === 'ja' ? '分析結果' : 'Analysis Results'}
        </h2>

        {!result && !analyzeMutation.isPending && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <ImageIcon className="h-16 w-16 text-gray-200 mb-3" />
            <p className="text-gray-400">
              {locale === 'ja' ? '図面をアップロードしてAI分析を実行してください' : 'Upload a drawing and run AI analysis'}
            </p>
          </div>
        )}

        {analyzeMutation.isPending && (
          <div className="flex flex-col items-center justify-center h-64">
            <Loader2 className="h-12 w-12 animate-spin text-purple-500 mb-4" />
            <p className="text-gray-600">{locale === 'ja' ? 'GPT-4o Visionが図面を分析中...' : 'GPT-4o Vision analyzing drawing...'}</p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* Status */}
            <div className={`flex items-center gap-2 p-3 rounded-lg ${result.success ? 'bg-green-50' : 'bg-red-50'}`}>
              {result.success ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-600" />
              )}
              <span className={`font-medium text-sm ${result.success ? 'text-green-700' : 'text-red-700'}`}>
                {result.success
                  ? (locale === 'ja' ? '分析完了' : 'Analysis Complete')
                  : (result.error || (locale === 'ja' ? '分析に失敗しました' : 'Analysis failed'))}
              </span>
              {result.success && (
                <span className="ml-auto text-xs text-gray-500">
                  {locale === 'ja' ? '信頼度' : 'Confidence'}: {(result.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>

            {result.success && (
              <>
                {/* Building Info */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">{locale === 'ja' ? '建物形状' : 'Shape'}</p>
                    <p className="font-semibold text-gray-800">{result.buildingShape}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">{locale === 'ja' ? '図面種類' : 'Drawing Type'}</p>
                    <p className="font-semibold text-gray-800">{result.drawingType}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">{locale === 'ja' ? '建物高さ' : 'Height'}</p>
                    <p className="font-semibold text-gray-800">
                      {result.buildingHeightMm != null ? `${result.buildingHeightMm.toLocaleString()} mm` : '—'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">{locale === 'ja' ? '階数' : 'Floors'}</p>
                    <p className="font-semibold text-gray-800">{result.floorCount || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">{locale === 'ja' ? '構造' : 'Structure'}</p>
                    <p className="font-semibold text-gray-800">{result.structureType || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">{locale === 'ja' ? '縮尺' : 'Scale'}</p>
                    <p className="font-semibold text-gray-800">{result.scale || '—'}</p>
                  </div>
                </div>

                {/* Walls */}
                {result.walls.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">
                      {locale === 'ja' ? '検出された壁面' : 'Detected Walls'}
                    </h3>
                    <div className="space-y-2">
                      {result.walls.map((wall, i) => (
                        <div key={i} className="flex items-center justify-between bg-blue-50 rounded-lg px-4 py-2">
                          <span className="font-medium text-blue-800">
                            {SIDE_LABELS[wall.side] || wall.side}
                          </span>
                          <span className="text-sm text-blue-600">
                            {wall.lengthMm != null ? wall.lengthMm.toLocaleString() : '—'} × {wall.heightMm != null ? wall.heightMm.toLocaleString() : '—'} mm
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Edge order preview for polygon-style workflows */}
                {result.walls.length > 1 && (
                  <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100">
                    <p className="text-xs text-indigo-700 font-medium mb-2">
                      {locale === 'ja' ? '辺順序プレビュー' : 'Edge Order Preview'}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      {result.walls.map((wall, i) => (
                        <span
                          key={`edge-order-${i}`}
                          className="px-2 py-0.5 rounded-md bg-white border border-indigo-200 text-xs text-indigo-800 font-medium"
                        >
                          {SIDE_LABELS[wall.side] || wall.side}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-indigo-600">
                      {result.walls.map((wall) => SIDE_LABELS[wall.side] || wall.side).join(' -> ')}
                    </p>
                  </div>
                )}

                {/* Notes */}
                {result.notes && (
                  <div className="bg-amber-50 rounded-lg p-3">
                    <p className="text-xs text-amber-600 font-medium mb-1">{locale === 'ja' ? 'AI備考' : 'AI Notes'}</p>
                    <p className="text-sm text-amber-800">{result.notes}</p>
                  </div>
                )}

                {/* Next action */}
                <div className="pt-2">
                  <button
                    onClick={() => {
                      try {
                        sessionStorage.setItem(
                          'aiVisionResult',
                          JSON.stringify({
                            buildingHeightMm: result.buildingHeightMm,
                            floorCount: result.floorCount,
                            structureType: result.structureType,
                            walls: result.walls,
                            drawingType: result.drawingType,
                            scale: result.scale,
                            buildingShape: result.buildingShape,
                            confidence: result.confidence,
                          }),
                        );
                      } catch {
                        // Ignore storage errors and still allow navigation.
                      }
                      router.push('/scaffold?fromAi=1');
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                  >
                    <Calculator className="h-5 w-5" />
                    {locale === 'ja' ? 'この結果で足場計算へ進む' : 'Continue to Scaffold Calculator'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  {(result.buildingHeightMm == null || result.walls.some((w) => w.heightMm == null)) && (
                    <p className="mt-2 text-xs text-gray-500 text-center">
                      {locale === 'ja'
                        ? '平面図では高さが未検出の場合があります。次の画面で高さを入力してください。'
                        : 'Height is often missing in plan drawings. Please set building/wall height in the next screen.'}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Anomaly Detection Tab ───────────────────────────────────

function AnomalyTab({ locale }: { locale: string }) {
  const [configId, setConfigId] = useState('');
  const [result, setResult] = useState<AnomalyDetectionResult | null>(null);

  const detectMutation = useMutation({
    mutationFn: (id: string) => aiApi.detectAnomalies(id),
    onSuccess: (data) => setResult(data),
  });

  const handleDetect = () => {
    if (configId.trim()) {
      detectMutation.mutate(configId.trim());
    }
  };

  const severityConfig = {
    critical: { icon: AlertTriangle, color: 'bg-red-50 border-red-200 text-red-700', iconColor: 'text-red-500', label: locale === 'ja' ? '重大' : 'Critical' },
    warning: { icon: AlertTriangle, color: 'bg-amber-50 border-amber-200 text-amber-700', iconColor: 'text-amber-500', label: locale === 'ja' ? '注意' : 'Warning' },
    info: { icon: Info, color: 'bg-blue-50 border-blue-200 text-blue-700', iconColor: 'text-blue-500', label: locale === 'ja' ? '情報' : 'Info' },
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-green-500" />
        {locale === 'ja' ? '見積もり品質チェック' : 'Estimate Quality Review'}
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        {locale === 'ja'
          ? 'AIが足場の数量を分析し、異常値や安全上の問題を検出します。'
          : 'AI analyzes scaffold quantities and detects anomalies or safety concerns.'}
      </p>

      {/* Input */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          value={configId}
          onChange={(e) => setConfigId(e.target.value)}
          placeholder={locale === 'ja' ? '計算済みの設定IDを入力...' : 'Enter calculated config ID...'}
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500"
        />
        <button
          onClick={handleDetect}
          disabled={!configId.trim() || detectMutation.isPending}
          className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 font-medium"
        >
          {detectMutation.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ShieldCheck className="h-5 w-5" />
          )}
          {locale === 'ja' ? 'チェック実行' : 'Run Check'}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Overall Assessment */}
          <div className={`p-4 rounded-xl font-medium ${
            result.critical.length > 0
              ? 'bg-red-50 text-red-700'
              : result.warnings.length > 0
              ? 'bg-amber-50 text-amber-700'
              : 'bg-green-50 text-green-700'
          }`}>
            {result.overallAssessment}
          </div>

          {/* Anomaly List */}
          {[...result.critical, ...result.warnings, ...result.info].map((anomaly, i) => {
            const config = severityConfig[anomaly.severity];
            const Icon = config.icon;
            return (
              <div key={i} className={`border rounded-lg p-4 ${config.color}`}>
                <div className="flex items-start gap-3">
                  <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${config.iconColor}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold uppercase">{config.label}</span>
                      <span className="text-xs opacity-75">• {anomaly.component}</span>
                    </div>
                    <p className="text-sm font-medium">
                      {locale === 'ja' ? anomaly.messageJa : anomaly.messageEn}
                    </p>
                    {anomaly.suggestion && (
                      <p className="text-xs mt-1 opacity-75">
                        💡 {anomaly.suggestion}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {result.totalAnomalies === 0 && result.success && (
            <div className="flex flex-col items-center py-8 text-center">
              <CheckCircle className="h-16 w-16 text-green-300 mb-3" />
              <p className="text-green-600 font-medium">
                {locale === 'ja' ? '問題は検出されませんでした' : 'No issues detected'}
              </p>
            </div>
          )}
        </div>
      )}

      {!result && !detectMutation.isPending && (
        <div className="flex flex-col items-center py-12 text-center">
          <ShieldCheck className="h-16 w-16 text-gray-200 mb-3" />
          <p className="text-gray-400">
            {locale === 'ja'
              ? '計算済みの設定IDを入力してチェックを実行してください'
              : 'Enter a calculated config ID to run quality check'}
          </p>
        </div>
      )}
    </div>
  );
}
