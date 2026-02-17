'use client';

import { useState, useRef, useCallback } from 'react';

interface ScoreBreakdown {
  [category: string]: {
    score: number;
    max: number;
    notes: string;
  };
}

interface PipelineResult {
  html: string;
  schema: Record<string, unknown>;
  observations: {
    industryCandidates: { label: string; confidence: number }[];
    visualProblems: string[];
    visualGoals: string[];
    brandSignals: { perceivedTone: string; complexity: string; trustLevel: string };
    paletteObserved: { primary?: string; accents?: string[]; background?: string };
    avoidPatterns: string[];
  };
  styleSpec: {
    signature: string;
    presetId: string;
    fontPairingId: string;
    density: string;
    visualMotifs: string[];
    sectionSeparators: string;
    antiTemplateRules: string[];
  };
  layoutPlan?: {
    signature: string;
    presetId: string;
    fontPairingId: string;
    density: string;
    blockOrder: { type: string; variant: string; rationale: string }[];
    diversityPatterns: string[];
    designRationale: string;
  };
  score?: {
    total: number;
    mustImprove: boolean;
    breakdown: ScoreBreakdown;
  };
  qaResult?: {
    patches: { action: string; blockIndex: number; field?: string; oldValue?: string; newValue?: string; newBlockType?: string; newVariant?: string; reason: string }[];
    critique: string;
    diff: string[];
  };
  warnings: string[];
  signature: string;
  density: string;
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
  schemaV1?: Record<string, unknown>;
}

interface StepInfo {
  name: string;
  status: 'running' | 'done' | 'error' | 'skipped';
  ms?: number;
  error?: string;
}

type AppState =
  | { status: 'idle' }
  | { status: 'loading'; steps: StepInfo[]; currentStep: string }
  | { status: 'success'; data: PipelineResult; steps: StepInfo[] }
  | { status: 'error'; message: string; steps: StepInfo[] };

type Tab = 'preview' | 'html' | 'schema' | 'debug';

const STEP_LABELS: Record<string, string> = {
  screenshots: 'Capturing screenshots',
  extract: 'Extracting content',
  observe: 'Observing design (Gemini)',
  style_director: 'Selecting style signature',
  layout_plan: 'Creating layout plan',
  claude_content: 'Generating content (Claude)',
  validate: 'Validating schema',
  score: 'Scoring design',
  illustrations: 'Generating illustrations (Recraft)',
  render: 'Rendering HTML',
  qa_loop: 'Running visual QA',
};

function resolveBackendUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  return raw.startsWith('http') ? raw : `https://${raw}`;
}
const BACKEND_URL = resolveBackendUrl();

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

function SignatureBadge({ signature }: { signature: string }) {
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800">
      {signature}
    </span>
  );
}

function StepList({ steps }: { steps: StepInfo[] }) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          {step.status === 'running' && (
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          )}
          {step.status === 'done' && (
            <span className="text-green-600 w-4 text-center">+</span>
          )}
          {step.status === 'error' && (
            <span className="text-red-600 w-4 text-center">x</span>
          )}
          {step.status === 'skipped' && (
            <span className="text-gray-400 w-4 text-center">-</span>
          )}
          <span className={step.status === 'error' ? 'text-red-700' : 'text-gray-700'}>
            {STEP_LABELS[step.name] || step.name}
          </span>
          {step.ms !== undefined && (
            <span className="text-gray-400 text-xs">{(step.ms / 1000).toFixed(1)}s</span>
          )}
          {step.error && (
            <span className="text-red-500 text-xs">{step.error}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [withIllustrations, setWithIllustrations] = useState(false);
  const [withQA, setWithQA] = useState(false);
  const [state, setState] = useState<AppState>({ status: 'idle' });
  const [activeTab, setActiveTab] = useState<Tab>('preview');
  const abortRef = useRef<AbortController | null>(null);

  const handleRedesign = useCallback(async () => {
    if (!url.trim()) return;

    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http')) {
      targetUrl = `https://${targetUrl}`;
    }

    abortRef.current = new AbortController();
    setState({ status: 'loading', steps: [], currentStep: 'Starting...' });

    try {
      const response = await fetch(`${BACKEND_URL}/redesign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, withIllustrations, withQA }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `Request failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error('No response body — streaming not supported');
      }

      // Read NDJSON stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const steps: StepInfo[] = [];
      let result: PipelineResult | null = null;
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
              result = event.result;
            } else if (event.step === 'error') {
              pipelineError = event.error;
            } else {
              // Update step tracking
              const existing = steps.find((s) => s.name === event.step);
              if (existing) {
                existing.status = event.status;
                existing.ms = event.ms;
                existing.error = event.error;
              } else {
                steps.push({
                  name: event.step,
                  status: event.status,
                  ms: event.ms,
                  error: event.error,
                });
              }

              setState({
                status: 'loading',
                steps: [...steps],
                currentStep: STEP_LABELS[event.step] || event.step,
              });
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      if (result) {
        setState({ status: 'success', data: result, steps: [...steps] });
        setActiveTab('preview');
      } else if (pipelineError) {
        setState({ status: 'error', message: pipelineError, steps: [...steps] });
      } else {
        setState({ status: 'error', message: 'Pipeline ended without result', steps: [...steps] });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong',
        steps: [],
      });
    }
  }, [url, withIllustrations, withQA]);

  function handleDownload() {
    if (state.status !== 'success') return;
    const blob = new Blob([state.data.html], { type: 'text/html' });
    const dl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dl;
    a.download = 'redesign.html';
    a.click();
    URL.revokeObjectURL(dl);
  }

  function handleCopyHtml() {
    if (state.status !== 'success') return;
    navigator.clipboard.writeText(state.data.html);
  }

  // Count diversity blocks in schema
  const diversityBlockTypes = new Set(['BentoGrid', 'FeatureZigzag', 'StatsBand', 'ProcessTimeline']);
  function countDiversityBlocks(schema: Record<string, unknown>): number {
    const blocks = (schema as { blocks?: { type: string }[] }).blocks;
    if (!Array.isArray(blocks)) return 0;
    return blocks.filter((b) => diversityBlockTypes.has(b.type)).length;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">AI Website Redesign</h1>
          <span className="text-xs text-gray-400">v3.0 — Signature Pipeline</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Input Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRedesign()}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
              disabled={state.status === 'loading'}
            />
            <button
              onClick={handleRedesign}
              disabled={state.status === 'loading' || !url.trim()}
              className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {state.status === 'loading' ? 'Redesigning...' : 'Redesign'}
            </button>
          </div>

          <div className="mt-3 flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
              <input
                type="checkbox"
                checked={withIllustrations}
                onChange={(e) => setWithIllustrations(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                disabled={state.status === 'loading'}
              />
              Generate illustrations (Recraft)
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
              <input
                type="checkbox"
                checked={withQA}
                onChange={(e) => setWithQA(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                disabled={state.status === 'loading'}
              />
              Run visual QA loop
            </label>
          </div>
        </div>

        {/* Loading State */}
        {state.status === 'loading' && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-700 font-medium">{state.currentStep}</p>
            </div>
            <StepList steps={state.steps} />
          </div>
        )}

        {/* Error State */}
        {state.status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
            <p className="text-red-800 font-medium">Pipeline Error</p>
            <p className="text-red-600 mt-1">{state.message}</p>
            {state.steps.length > 0 && (
              <div className="mt-4 pt-4 border-t border-red-200">
                <p className="text-sm font-medium text-red-700 mb-2">Steps completed before failure:</p>
                <StepList steps={state.steps} />
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {state.status === 'success' && (
          <div>
            {/* Tab Bar */}
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
                      {tab === 'preview' && 'Preview'}
                      {tab === 'html' && 'HTML'}
                      {tab === 'schema' && 'Schema'}
                      {tab === 'debug' && 'Debug'}
                    </button>
                  ))}
                </div>
                {state.data.score && (
                  <ScoreBadge score={state.data.score.total} mustImprove={state.data.score.mustImprove} />
                )}
                {state.data.signature && (
                  <SignatureBadge signature={state.data.signature} />
                )}
              </div>

              <div className="flex gap-2">
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
              {/* Preview Tab */}
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

              {/* HTML Tab */}
              {activeTab === 'html' && (
                <div className="p-4">
                  <textarea
                    readOnly
                    value={state.data.html}
                    className="w-full h-[70vh] font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg p-4 resize-none focus:outline-none panel-scroll"
                  />
                </div>
              )}

              {/* Schema Tab */}
              {activeTab === 'schema' && (
                <div className="p-4">
                  <pre className="w-full h-[70vh] overflow-auto font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg p-4 panel-scroll">
                    {JSON.stringify(state.data.schema, null, 2)}
                  </pre>
                </div>
              )}

              {/* Debug Tab */}
              {activeTab === 'debug' && (
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto panel-scroll">
                  {/* Pipeline Steps */}
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Pipeline Steps</h3>
                    <StepList steps={state.steps} />
                  </div>

                  {/* Warnings */}
                  {state.data.warnings.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">Warnings</h3>
                      <ul className="space-y-1">
                        {state.data.warnings.map((w, i) => (
                          <li key={i} className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded">
                            {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

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
                        <div className="flex flex-wrap gap-3 text-sm">
                          <span className="text-gray-500">Signature:</span>
                          <code className="text-purple-700 font-semibold">{state.data.manifest.signatureApplied || 'none'}</code>
                          <span className="text-gray-500 ml-3">Density:</span>
                          <code className="text-gray-700">{state.data.manifest.density}</code>
                          <span className="text-gray-500 ml-3">Version:</span>
                          <code className={state.data.manifest.version === 'v2' ? 'text-green-700 font-semibold' : 'text-gray-700'}>{state.data.manifest.version}</code>
                        </div>
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

                  {/* Style Spec Summary */}
                  {state.data.styleSpec && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">Style Specification</h3>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                        <div className="flex flex-wrap gap-4 text-sm">
                          <span className="text-gray-500">Signature:</span>
                          <code className="font-semibold text-purple-700">{state.data.styleSpec.signature}</code>
                          <span className="text-gray-500 ml-4">Preset:</span>
                          <code className="text-gray-700">{state.data.styleSpec.presetId}</code>
                          <span className="text-gray-500 ml-4">Density:</span>
                          <code className="text-gray-700">{state.data.styleSpec.density}</code>
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm">
                          <span className="text-gray-500">Fonts:</span>
                          <code className="text-gray-700">{state.data.styleSpec.fontPairingId}</code>
                          <span className="text-gray-500 ml-4">Separators:</span>
                          <code className="text-gray-700">{state.data.styleSpec.sectionSeparators}</code>
                        </div>
                        {state.data.styleSpec.visualMotifs.length > 0 && (
                          <div className="text-sm">
                            <span className="text-gray-500">Motifs: </span>
                            {state.data.styleSpec.visualMotifs.map((m, i) => (
                              <span key={i} className="inline-block bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-xs mr-1">{m}</span>
                            ))}
                          </div>
                        )}
                        {state.data.styleSpec.antiTemplateRules.length > 0 && (
                          <div className="text-sm">
                            <span className="text-gray-500">Anti-template rules: </span>
                            {state.data.styleSpec.antiTemplateRules.map((r, i) => (
                              <span key={i} className="inline-block bg-red-50 text-red-700 px-2 py-0.5 rounded text-xs mr-1">{r}</span>
                            ))}
                          </div>
                        )}
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
                      <div className="text-sm text-gray-500 mb-2">
                        Diversity blocks: {countDiversityBlocks(state.data.schema)}
                      </div>
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

                  {/* Layout Plan */}
                  {state.data.layoutPlan && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">Layout Plan</h3>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                        <div className="flex flex-wrap gap-4 text-sm">
                          <span className="text-gray-500">Signature:</span>
                          <code className="text-purple-700">{state.data.layoutPlan.signature}</code>
                          <span className="text-gray-500 ml-4">Preset:</span>
                          <code className="text-gray-700">{state.data.layoutPlan.presetId}</code>
                          <span className="text-gray-500 ml-4">Fonts:</span>
                          <code className="text-gray-700">{state.data.layoutPlan.fontPairingId}</code>
                          <span className="text-gray-500 ml-4">Density:</span>
                          <code className="text-gray-700">{state.data.layoutPlan.density}</code>
                        </div>
                        {state.data.layoutPlan.diversityPatterns.length > 0 && (
                          <div className="text-sm">
                            <span className="text-gray-500">Diversity patterns: </span>
                            {state.data.layoutPlan.diversityPatterns.map((p, i) => (
                              <span key={i} className="inline-block bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs mr-1">{p}</span>
                            ))}
                          </div>
                        )}
                        <p className="text-sm text-gray-600">{state.data.layoutPlan.designRationale}</p>
                        <div className="space-y-1">
                          {state.data.layoutPlan.blockOrder.map((block, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                              <span className="text-gray-400 font-mono w-6">{i + 1}.</span>
                              <span className="font-medium text-gray-700">{block.type}</span>
                              <span className="text-blue-600">({block.variant})</span>
                              <span className="text-gray-400">— {block.rationale}</span>
                            </div>
                          ))}
                        </div>
                      </div>
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
                                  patch.action === 'remove' ? 'bg-red-100 text-red-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>{patch.action}</span>
                                <span className="font-mono text-gray-400">
                                  Block[{patch.blockIndex}]
                                  {patch.field && `.${patch.field}`}
                                  {patch.newBlockType && ` ${patch.newBlockType}`}
                                  {patch.newVariant && ` → ${patch.newVariant}`}
                                </span>
                              </div>
                              <p className="text-gray-500">{patch.reason}</p>
                              {patch.oldValue && patch.newValue && (
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="line-through text-red-400 text-xs truncate max-w-[200px]">{patch.oldValue}</span>
                                  <span className="text-gray-400">&rarr;</span>
                                  <span className="text-green-700 text-xs truncate max-w-[200px]">{patch.newValue}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">No patches applied.</p>
                      )}
                    </div>
                  )}

                  {/* Observations (Gemini) */}
                  {state.data.observations && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">Observations (Gemini)</h3>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                        <div className="text-sm">
                          <span className="text-gray-500">Industry: </span>
                          {state.data.observations.industryCandidates.map((c, i) => (
                            <span key={i} className="inline-block bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs mr-1">
                              {c.label} ({(c.confidence * 100).toFixed(0)}%)
                            </span>
                          ))}
                        </div>
                        <div className="text-sm">
                          <span className="text-gray-500">Brand: </span>
                          <span className="text-gray-700">
                            {state.data.observations.brandSignals.perceivedTone} / {state.data.observations.brandSignals.complexity} / trust: {state.data.observations.brandSignals.trustLevel}
                          </span>
                        </div>
                        {state.data.observations.visualProblems.length > 0 && (
                          <div className="text-sm">
                            <p className="text-gray-500 mb-1">Visual Problems:</p>
                            <ul className="list-disc list-inside space-y-0.5">
                              {state.data.observations.visualProblems.map((p, i) => (
                                <li key={i} className="text-red-600">{p}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {state.data.observations.visualGoals.length > 0 && (
                          <div className="text-sm">
                            <p className="text-gray-500 mb-1">Visual Goals:</p>
                            <ul className="list-disc list-inside space-y-0.5">
                              {state.data.observations.visualGoals.map((g, i) => (
                                <li key={i} className="text-green-700">{g}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {state.data.observations.avoidPatterns.length > 0 && (
                          <div className="text-sm">
                            <span className="text-gray-500">Avoid: </span>
                            {state.data.observations.avoidPatterns.map((a, i) => (
                              <span key={i} className="inline-block bg-red-50 text-red-600 px-2 py-0.5 rounded text-xs mr-1">{a}</span>
                            ))}
                          </div>
                        )}
                        {state.data.observations.paletteObserved.primary && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-500">Observed palette:</span>
                            {state.data.observations.paletteObserved.primary && (
                              <span className="flex items-center gap-1">
                                <span className="inline-block w-4 h-4 rounded border border-gray-300" style={{ backgroundColor: state.data.observations.paletteObserved.primary }} />
                                <code className="text-gray-600 text-xs">{state.data.observations.paletteObserved.primary}</code>
                              </span>
                            )}
                            {state.data.observations.paletteObserved.accents?.map((a, i) => (
                              <span key={i} className="flex items-center gap-1">
                                <span className="inline-block w-4 h-4 rounded border border-gray-300" style={{ backgroundColor: a }} />
                                <code className="text-gray-600 text-xs">{a}</code>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Design Tokens */}
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Design Tokens</h3>
                    <div className="flex flex-wrap gap-4">
                      {state.data.schema &&
                        typeof state.data.schema === 'object' &&
                        'tokens' in state.data.schema &&
                        (() => {
                          const tokens = state.data.schema.tokens as Record<string, string>;
                          return Object.entries(tokens).map(([key, value]) => (
                            <div key={key} className="flex items-center gap-2 text-sm">
                              <span className="text-gray-500">{key}:</span>
                              {typeof value === 'string' && value.startsWith('#') ? (
                                <span className="flex items-center gap-1">
                                  <span
                                    className="inline-block w-4 h-4 rounded border border-gray-300"
                                    style={{ backgroundColor: value }}
                                  />
                                  <code className="text-gray-700">{value}</code>
                                </span>
                              ) : (
                                <code className="text-gray-700">{value}</code>
                              )}
                            </div>
                          ));
                        })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
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
              Enter any public website URL and our AI pipeline will analyze its design,
              extract content, and generate a premium redesign preview.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
