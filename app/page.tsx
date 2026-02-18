'use client';

import { useState, useRef, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface StepInfo {
  name: string;
  status: 'running' | 'done' | 'error' | 'skipped';
  ms?: number;
  error?: string;
}

interface LayoutDNA {
  id: string;
  label: string;
  description: string;
  heroType: string;
  heroVariant: string;
  requiredBlocks: string[];
  requiredPatterns: string[];
  forbiddenBlocks: string[];
  blockCount: { min: number; max: number };
  structureHint: string;
}

interface Direction {
  id: string;
  styleId: string;
  styleLabel: string;
  confidence: number;
  reason: string;
  bestFor: string;
  previewHtml: string;
  dnaOptions?: LayoutDNA[];
}

interface FinalResult {
  styleId: string;
  html: string;
  schema: Record<string, unknown>;
  schemaV1?: Record<string, unknown>;
  manifest?: {
    blocks: { index: number; type: string; variant: string }[];
    tokensApplied: {
      palette: Record<string, string>;
      typography: { headingFont: string; bodyFont: string };
      borderRadius: string;
    };
    signatureApplied: string | null;
    density: string;
    schemaHash: string;
    version: string;
  };
  layoutPlan?: {
    styleId: string;
    blocks: { type: string; variant: string; rationale: string }[];
    layoutPatterns: string[];
  };
  score?: {
    total: number;
    mustImprove: boolean;
    breakdown: Record<string, { score: number; max: number; notes: string }>;
  };
  qaResult?: {
    patches: { action: string; blockIndex: number; field?: string; reason: string }[];
    critique: string;
    diff: string[];
  };
  warnings: string[];
  signature: string;
  density: string;
}

type AppState =
  | { status: 'idle' }
  | { status: 'loading_directions'; steps: StepInfo[]; currentStep: string }
  | { status: 'directions'; directions: Direction[]; observations: Record<string, unknown>; extractedContent: Record<string, unknown>; url: string }
  | { status: 'dna_selection'; styleId: string; styleLabel: string; dnas: LayoutDNA[]; url: string }
  | { status: 'loading_final'; steps: StepInfo[]; currentStep: string; selectedStyle: string; selectedDna?: string }
  | { status: 'final'; data: FinalResult; steps: StepInfo[]; styleId: string; dnaId?: string }
  | { status: 'error'; message: string; steps: StepInfo[] };

type Tab = 'preview' | 'html' | 'schema' | 'debug';

// ─── Constants ──────────────────────────────────────────────────────────────────

const DIRECTION_STEP_LABELS: Record<string, string> = {
  screenshots: 'Capturing screenshots',
  extract: 'Extracting content',
  observe: 'Analyzing design',
  select_styles: 'Selecting 3 style directions',
  preview_A: 'Generating preview A',
  preview_B: 'Generating preview B',
  preview_C: 'Generating preview C',
};

const FINALIZE_STEP_LABELS: Record<string, string> = {
  screenshots: 'Capturing screenshots',
  extract: 'Extracting content',
  observe: 'Analyzing design',
  layout_plan: 'Creating layout plan',
  page_schema: 'Generating page content',
  validate: 'Validating schema',
  score: 'Scoring design',
  illustrations: 'Generating illustrations',
  render: 'Rendering HTML',
  qa_loop: 'Running visual QA',
};

function resolveBackendUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  return raw.startsWith('http') ? raw : `https://${raw}`;
}
const BACKEND_URL = resolveBackendUrl();

// ─── NDJSON Stream Reader ───────────────────────────────────────────────────────

async function streamPipeline<T>(
  url: string,
  body: Record<string, unknown>,
  stepLabels: Record<string, string>,
  onStep: (steps: StepInfo[], currentStep: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errorData.error || `Request failed (${response.status})`);
  }

  if (!response.body) {
    throw new Error('No response body — streaming not supported');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const steps: StepInfo[] = [];
  let result: T | null = null;
  let pipelineError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.step === 'complete') {
          result = event.result as T;
        } else if (event.step === 'error') {
          pipelineError = event.error;
        } else {
          const existing = steps.find((s) => s.name === event.step);
          if (existing) {
            existing.status = event.status;
            existing.ms = event.ms;
            existing.error = event.error;
          } else {
            steps.push({ name: event.step, status: event.status, ms: event.ms, error: event.error });
          }
          onStep([...steps], stepLabels[event.step] || event.step);
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  if (result) return result;
  if (pipelineError) throw new Error(pipelineError);
  throw new Error('Pipeline ended without result');
}

// ─── Subcomponents ──────────────────────────────────────────────────────────────

function StepList({ steps, labels }: { steps: StepInfo[]; labels: Record<string, string> }) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          {step.status === 'running' && (
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          )}
          {step.status === 'done' && <span className="text-green-600 w-4 text-center">+</span>}
          {step.status === 'error' && <span className="text-red-600 w-4 text-center">x</span>}
          {step.status === 'skipped' && <span className="text-gray-400 w-4 text-center">-</span>}
          <span className={step.status === 'error' ? 'text-red-700' : 'text-gray-700'}>
            {labels[step.name] || step.name}
          </span>
          {step.ms !== undefined && (
            <span className="text-gray-400 text-xs">{(step.ms / 1000).toFixed(1)}s</span>
          )}
          {step.error && <span className="text-red-500 text-xs">{step.error}</span>}
        </div>
      ))}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? 'bg-green-100 text-green-800' :
    pct >= 60 ? 'bg-yellow-100 text-yellow-800' :
    'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {pct}% match
    </span>
  );
}

function ScoreBadge({ score, mustImprove }: { score: number; mustImprove?: boolean }) {
  const color = score >= 80 ? 'bg-green-100 text-green-800' :
    score >= 60 ? 'bg-yellow-100 text-yellow-800' :
    'bg-red-100 text-red-800';
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${color}`}>
      Score: {score}/100{mustImprove ? ' (needs QA)' : ''}
    </span>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function Home() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<AppState>({ status: 'idle' });
  const [activeTab, setActiveTab] = useState<Tab>('preview');
  const [enlargedPreview, setEnlargedPreview] = useState<{ html: string; label: string } | null>(null);
  const [designHistory, setDesignHistory] = useState<Array<{ data: FinalResult; styleId: string; dnaId?: string; timestamp: number }>>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Stored from directions step for reuse in finalize
  const directionsDataRef = useRef<{
    observations: Record<string, unknown>;
    extractedContent: Record<string, unknown>;
    url: string;
  } | null>(null);

  // ─── Generate Directions ────────────────────────────────────────────────────

  const handleGenerateDirections = useCallback(async () => {
    if (!url.trim()) return;

    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`;

    abortRef.current = new AbortController();
    setState({ status: 'loading_directions', steps: [], currentStep: 'Starting...' });

    try {
      const result = await streamPipeline<{
        observations: Record<string, unknown>;
        directions: Direction[];
        extractedContent: Record<string, unknown>;
      }>(
        `${BACKEND_URL}/directions`,
        { url: targetUrl },
        DIRECTION_STEP_LABELS,
        (steps, currentStep) => {
          setState({ status: 'loading_directions', steps, currentStep });
        },
        abortRef.current.signal,
      );

      directionsDataRef.current = {
        observations: result.observations,
        extractedContent: result.extractedContent,
        url: targetUrl,
      };

      setState({
        status: 'directions',
        directions: result.directions,
        observations: result.observations,
        extractedContent: result.extractedContent,
        url: targetUrl,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong',
        steps: [],
      });
    }
  }, [url]);

  // ─── Choose style → DNA selection ──────────────────────────────────────────

  const handleChooseStyle = useCallback((direction: Direction) => {
    const dirData = directionsDataRef.current;
    if (!dirData) return;

    const dnas = direction.dnaOptions || [];
    if (dnas.length > 0) {
      setState({
        status: 'dna_selection',
        styleId: direction.styleId,
        styleLabel: direction.styleLabel,
        dnas,
        url: dirData.url,
      });
    } else {
      // No DNAs available — go straight to finalize
      handleFinalize(direction.styleId);
    }
  }, []);

  // ─── Finalize (with style + optional DNA) ─────────────────────────────────

  const handleFinalize = useCallback(async (styleId: string, dnaId?: string) => {
    const dirData = directionsDataRef.current;
    if (!dirData) return;

    abortRef.current = new AbortController();
    setState({ status: 'loading_final', steps: [], currentStep: 'Starting...', selectedStyle: styleId, selectedDna: dnaId });

    try {
      const result = await streamPipeline<FinalResult>(
        `${BACKEND_URL}/finalize`,
        {
          url: dirData.url,
          styleId,
          dnaId,
          withIllustrations: true,
          runQa: true,
          extractedContent: dirData.extractedContent,
          observations: dirData.observations,
        },
        FINALIZE_STEP_LABELS,
        (steps, currentStep) => {
          setState({ status: 'loading_final', steps, currentStep, selectedStyle: styleId, selectedDna: dnaId });
        },
        abortRef.current.signal,
      );

      setState({ status: 'final', data: result, steps: [], styleId, dnaId });
      setDesignHistory(prev => [...prev, { data: result, styleId, dnaId, timestamp: Date.now() }]);
      setActiveTab('preview');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong',
        steps: [],
      });
    }
  }, []);

  // ─── Navigation ─────────────────────────────────────────────────────────────

  function goBackToIdle() {
    setState({ status: 'idle' });
    directionsDataRef.current = null;
  }

  // ─── Downloads ──────────────────────────────────────────────────────────────

  function handleDownload() {
    if (state.status !== 'final') return;
    const blob = new Blob([state.data.html], { type: 'text/html' });
    const dl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dl;
    a.download = 'redesign.html';
    a.click();
    URL.revokeObjectURL(dl);
  }

  function handleCopyHtml() {
    if (state.status !== 'final') return;
    navigator.clipboard.writeText(state.data.html);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">SiteForge</h1>
          <span className="text-xs text-gray-400">v4.0 — Style Library Pipeline</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ─── Screen 1: Input ─────────────────────────────────────────────── */}
        {(state.status === 'idle' || state.status === 'loading_directions') && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
              <div className="flex flex-col sm:flex-row gap-4">
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerateDirections()}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                  disabled={state.status === 'loading_directions'}
                />
                <button
                  onClick={handleGenerateDirections}
                  disabled={state.status === 'loading_directions' || !url.trim()}
                  className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {state.status === 'loading_directions' ? 'Analyzing...' : 'Generate Directions'}
                </button>
              </div>

            </div>

            {/* Loading State */}
            {state.status === 'loading_directions' && (
              <div className="bg-white rounded-xl border border-gray-200 p-8 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-700 font-medium">{state.currentStep}</p>
                </div>
                <StepList steps={state.steps} labels={DIRECTION_STEP_LABELS} />
              </div>
            )}

            {/* Empty State */}
            {state.status === 'idle' && (
              <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
                <div className="text-5xl mb-4">&#127912;</div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Paste a URL to get started
                </h2>
                <p className="text-gray-500 max-w-md mx-auto">
                  Enter any public website URL. We&apos;ll analyze its design and present
                  3 distinct style directions for you to choose from.
                </p>
              </div>
            )}
          </>
        )}

        {/* ─── Screen 2: Choose Direction ──────────────────────────────────── */}
        {state.status === 'directions' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Choose a Direction</h2>
                <p className="text-gray-500 mt-1">Pick the style that best fits your brand. We&apos;ll generate a full site with your chosen direction.</p>
              </div>
              <button
                onClick={goBackToIdle}
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
              >
                Try another URL
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {state.directions.map((dir) => (
                <div
                  key={dir.id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
                >
                  {/* Preview thumbnail — iframe scaled to fill container */}
                  <div
                    className="aspect-[4/3] bg-gray-100 relative overflow-hidden cursor-pointer group"
                    onClick={() => dir.previewHtml && setEnlargedPreview({ html: dir.previewHtml, label: `${dir.id} — ${dir.styleLabel}` })}
                    title="Click to enlarge"
                  >
                    {dir.previewHtml ? (
                      <>
                        <iframe
                          srcDoc={dir.previewHtml}
                          className="absolute top-0 left-0 border-0 pointer-events-none"
                          style={{ width: '250%', height: '250%', transform: 'scale(0.4)', transformOrigin: 'top left' }}
                          sandbox="allow-scripts allow-same-origin"
                          title={`${dir.styleLabel} preview`}
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-sm text-gray-900 px-3 py-1.5 rounded-full text-sm font-semibold shadow-sm">
                            Click to enlarge
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                        Preview unavailable
                      </div>
                    )}
                    <div className="absolute top-3 left-3 z-10">
                      <span className="bg-white/90 backdrop-blur-sm text-gray-900 px-2.5 py-1 rounded-full text-sm font-bold shadow-sm">
                        {dir.id}
                      </span>
                    </div>
                  </div>

                  <div className="p-5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-bold text-gray-900">{dir.styleLabel}</h3>
                      <ConfidenceBadge confidence={dir.confidence} />
                    </div>
                    <p className="text-sm text-blue-700 font-medium mb-2">{dir.bestFor}</p>
                    <p className="text-sm text-gray-600 mb-4">{dir.reason}</p>
                    <button
                      onClick={() => handleChooseStyle(dir)}
                      className="w-full px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      Choose This Style
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ─── Screen 2.5: Choose Layout DNA ──────────────────────────────── */}
        {state.status === 'dna_selection' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Choose a Layout</h2>
                <p className="text-gray-500 mt-1">
                  Style: <span className="font-semibold text-purple-700">{state.styleLabel}</span> — Pick a structural blueprint for your page.
                </p>
              </div>
              <button
                onClick={goBackToIdle}
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
              >
                Start over
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {state.dnas.map((dna) => (
                <div
                  key={dna.id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
                >
                  <div className="p-5">
                    <h3 className="text-lg font-bold text-gray-900 mb-1">{dna.label}</h3>
                    <p className="text-sm text-gray-600 mb-3">{dna.description}</p>

                    <div className="mb-3">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 mr-2">
                        {dna.heroType}
                      </span>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {dna.heroVariant}
                      </span>
                    </div>

                    <div className="mb-3">
                      <p className="text-xs text-gray-500 font-medium mb-1">Required blocks:</p>
                      <div className="flex flex-wrap gap-1">
                        {dna.requiredBlocks.map((rb) => (
                          <span key={rb} className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{rb}</span>
                        ))}
                      </div>
                    </div>

                    <div className="mb-3">
                      <p className="text-xs text-gray-500 font-medium mb-1">Patterns:</p>
                      <div className="flex flex-wrap gap-1">
                        {dna.requiredPatterns.map((rp) => (
                          <span key={rp} className="inline-block px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs">{rp}</span>
                        ))}
                      </div>
                    </div>

                    <p className="text-xs text-gray-400 italic mb-4">{dna.structureHint}</p>

                    <button
                      onClick={() => handleFinalize(state.styleId, dna.id)}
                      className="w-full px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      Choose This Layout
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-center">
              <button
                onClick={() => handleFinalize(state.styleId)}
                className="text-sm text-gray-500 hover:text-gray-700 underline transition-colors"
              >
                Skip — let AI choose the layout
              </button>
            </div>
          </>
        )}

        {/* ─── Loading Final ───────────────────────────────────────────────── */}
        {state.status === 'loading_final' && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 mb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-700 font-medium">{state.currentStep}</p>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Generating final design with style: <span className="font-semibold text-gray-700">{state.selectedStyle}</span>
              {state.selectedDna && <> / DNA: <span className="font-semibold text-purple-700">{state.selectedDna}</span></>}
            </p>
            <StepList steps={state.steps} labels={FINALIZE_STEP_LABELS} />
          </div>
        )}

        {/* ─── Screen 3: Final Result ──────────────────────────────────────── */}
        {state.status === 'final' && (
          <>
            {/* History strip */}
            {designHistory.length > 1 && (
              <div className="mb-4">
                <p className="text-xs text-gray-500 font-medium mb-2">Previous versions ({designHistory.length})</p>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {designHistory.map((entry, idx) => {
                    const isActive = entry.data === state.data;
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          setState({ status: 'final', data: entry.data, steps: [], styleId: entry.styleId, dnaId: entry.dnaId });
                          setActiveTab('preview');
                        }}
                        className={`shrink-0 px-3 py-2 rounded-lg border text-left text-xs transition-colors ${
                          isActive
                            ? 'border-blue-500 bg-blue-50 text-blue-900'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-semibold">#{idx + 1} {entry.data.styleId}</div>
                        <div className="text-gray-400">
                          {entry.data.score ? `${entry.data.score.total}pts` : ''}{' '}
                          {entry.dnaId ? ` / ${entry.dnaId}` : ''}
                        </div>
                        <div className="text-gray-400">{new Date(entry.timestamp).toLocaleTimeString()}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          <div>
            {/* Action Bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                  {(['preview', 'html', 'schema', 'debug'] as Tab[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeTab === tab
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>
                {state.data.score && (
                  <ScoreBadge score={state.data.score.total} mustImprove={state.data.score.mustImprove} />
                )}
                {state.data.styleId && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800">
                    {state.data.styleId}
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => state.status === 'final' && handleFinalize(state.styleId, state.dnaId)}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Regenerate
                </button>
                <button
                  onClick={goBackToIdle}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  New URL
                </button>
                <button
                  onClick={handleCopyHtml}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
                >
                  Copy HTML
                </button>
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                >
                  Download HTML
                </button>
              </div>
            </div>

            {/* Tab Content */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {activeTab === 'preview' && (
                <iframe
                  key={state.data.manifest?.schemaHash || 'preview'}
                  srcDoc={state.data.html}
                  className="w-full border-0"
                  style={{ height: '80vh' }}
                  sandbox="allow-scripts allow-same-origin"
                  title="Redesign Preview"
                />
              )}

              {activeTab === 'html' && (
                <div className="p-4">
                  <textarea
                    readOnly
                    value={state.data.html}
                    className="w-full h-[70vh] font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg p-4 resize-none focus:outline-none"
                  />
                </div>
              )}

              {activeTab === 'schema' && (
                <div className="p-4">
                  <pre className="w-full h-[70vh] overflow-auto font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg p-4">
                    {JSON.stringify(state.data.schema, null, 2)}
                  </pre>
                </div>
              )}

              {activeTab === 'debug' && (
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                  {/* Style Info */}
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Style</h3>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <div className="flex flex-wrap gap-4 text-sm">
                        <span className="text-gray-500">Style ID:</span>
                        <code className="font-semibold text-purple-700">{state.data.styleId}</code>
                        <span className="text-gray-500 ml-4">Signature:</span>
                        <code className="text-gray-700">{state.data.signature}</code>
                        <span className="text-gray-500 ml-4">Density:</span>
                        <code className="text-gray-700">{state.data.density}</code>
                      </div>
                    </div>
                  </div>

                  {/* Render Manifest */}
                  {state.data.manifest && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        Render Manifest
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          hash: {state.data.manifest.schemaHash} | {state.data.manifest.version}
                        </span>
                      </h3>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                        <div>
                          <p className="text-xs text-gray-500 font-medium mb-1">Rendered Blocks ({state.data.manifest.blocks.length})</p>
                          <div className="space-y-0.5">
                            {state.data.manifest.blocks.map((b) => (
                              <div key={b.index} className="flex items-center gap-2 text-sm">
                                <span className="text-gray-400 font-mono w-6">{b.index}.</span>
                                <span className="font-medium text-gray-700">{b.type}</span>
                                <span className="text-blue-600">({b.variant})</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 font-medium mb-1">Tokens Applied</p>
                          <div className="flex flex-wrap gap-3">
                            {Object.entries(state.data.manifest.tokensApplied.palette).map(([key, val]) => (
                              <div key={key} className="flex items-center gap-1 text-xs">
                                <span className="text-gray-400">{key}:</span>
                                {typeof val === 'string' && val.startsWith('#') ? (
                                  <span className="flex items-center gap-0.5">
                                    <span className="inline-block w-3 h-3 rounded border border-gray-300" style={{ backgroundColor: val }} />
                                    <code className="text-gray-600">{val}</code>
                                  </span>
                                ) : (
                                  <code className="text-gray-600">{val}</code>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-3 mt-1 text-xs">
                            <span className="text-gray-400">Fonts:</span>
                            <code className="text-gray-600">{state.data.manifest.tokensApplied.typography.headingFont} / {state.data.manifest.tokensApplied.typography.bodyFont}</code>
                            <span className="text-gray-400 ml-2">Radius:</span>
                            <code className="text-gray-600">{state.data.manifest.tokensApplied.borderRadius}</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Layout Plan */}
                  {state.data.layoutPlan && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">Layout Plan</h3>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                        {state.data.layoutPlan.layoutPatterns && state.data.layoutPlan.layoutPatterns.length > 0 && (
                          <div className="text-sm">
                            <span className="text-gray-500">Layout patterns: </span>
                            {state.data.layoutPlan.layoutPatterns.map((p, i) => (
                              <span key={i} className="inline-block bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs mr-1">{p}</span>
                            ))}
                          </div>
                        )}
                        <div className="space-y-1">
                          {state.data.layoutPlan.blocks.map((block, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                              <span className="text-gray-400 font-mono w-6">{i + 1}.</span>
                              <span className="font-medium text-gray-700">{block.type}</span>
                              <span className="text-blue-600">({block.variant})</span>
                              <span className="text-gray-400">-- {block.rationale}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Design Score */}
                  {state.data.score && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        Design Score: {state.data.score.total}/100
                        {state.data.score.mustImprove && (
                          <span className="text-sm font-normal text-red-600 ml-2">(must improve)</span>
                        )}
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-2 pr-4 text-gray-500 font-medium">Category</th>
                              <th className="text-right py-2 px-4 text-gray-500 font-medium">Score</th>
                              <th className="text-right py-2 px-4 text-gray-500 font-medium">Max</th>
                              <th className="text-left py-2 pl-4 text-gray-500 font-medium">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(state.data.score.breakdown).map(([key, val]) => (
                              <tr key={key} className="border-b border-gray-100">
                                <td className="py-2 pr-4 text-gray-700 capitalize">{key}</td>
                                <td className="py-2 px-4 text-right font-mono">{val.score}</td>
                                <td className="py-2 px-4 text-right font-mono text-gray-400">{val.max}</td>
                                <td className="py-2 pl-4 text-gray-500">{val.notes}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {state.data.warnings.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">Warnings</h3>
                      <ul className="space-y-1">
                        {state.data.warnings.map((w, i) => (
                          <li key={i} className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded">{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* QA Patches */}
                  {state.data.qaResult && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">Visual QA</h3>
                      <p className="text-sm text-gray-600 mb-3">{state.data.qaResult.critique}</p>
                      {state.data.qaResult.diff && state.data.qaResult.diff.length > 0 && (
                        <div className="mb-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
                          <p className="text-xs text-gray-500 font-medium mb-1">Schema Diff</p>
                          {state.data.qaResult.diff.map((d, i) => (
                            <p key={i} className="text-sm font-mono text-gray-700">{d}</p>
                          ))}
                        </div>
                      )}
                      {state.data.qaResult.patches.length > 0 ? (
                        <div className="space-y-2">
                          {state.data.qaResult.patches.map((patch, i) => (
                            <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                  patch.action === 'modify' ? 'bg-blue-100 text-blue-700' :
                                  patch.action === 'swap-variant' ? 'bg-purple-100 text-purple-700' :
                                  patch.action === 'insert' ? 'bg-green-100 text-green-700' :
                                  'bg-red-100 text-red-700'
                                }`}>{patch.action}</span>
                                <span className="font-mono text-gray-400">Block[{patch.blockIndex}]{patch.field && `.${patch.field}`}</span>
                              </div>
                              <p className="text-gray-500">{patch.reason}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">No patches applied.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          </>
        )}

        {/* ─── Enlarged Preview Modal ──────────────────────────────────────── */}
        {enlargedPreview && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setEnlargedPreview(null)}
          >
            <div
              className="bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col"
              style={{ width: '90vw', height: '85vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
                <h3 className="font-semibold text-gray-900">Preview: {enlargedPreview.label}</h3>
                <button
                  onClick={() => setEnlargedPreview(null)}
                  className="text-gray-400 hover:text-gray-700 transition-colors text-xl leading-none px-2"
                >
                  x
                </button>
              </div>
              <iframe
                srcDoc={enlargedPreview.html}
                className="w-full border-0 flex-1"
                style={{ minHeight: 0 }}
                sandbox="allow-scripts allow-same-origin"
                title="Enlarged preview"
              />
            </div>
          </div>
        )}

        {/* ─── Error State ─────────────────────────────────────────────────── */}
        {state.status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
            <p className="text-red-800 font-medium">Pipeline Error</p>
            <p className="text-red-600 mt-1">{state.message}</p>
            {state.steps.length > 0 && (
              <div className="mt-4 pt-4 border-t border-red-200">
                <p className="text-sm font-medium text-red-700 mb-2">Steps completed before failure:</p>
                <StepList steps={state.steps} labels={{ ...DIRECTION_STEP_LABELS, ...FINALIZE_STEP_LABELS }} />
              </div>
            )}
            <button
              onClick={goBackToIdle}
              className="mt-4 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
