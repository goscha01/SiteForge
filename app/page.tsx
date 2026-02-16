'use client';

import { useState, useRef } from 'react';

interface PipelineResult {
  html: string;
  schema: Record<string, unknown>;
  direction: Record<string, unknown>;
  warnings: string[];
}

type AppState =
  | { status: 'idle' }
  | { status: 'loading'; step: string }
  | { status: 'success'; data: PipelineResult }
  | { status: 'error'; message: string };

const STEPS = [
  'Capturing screenshots...',
  'Analyzing design with Gemini Vision...',
  'Generating layout with Claude...',
  'Validating schema...',
  'Rendering preview...',
];

type Tab = 'preview' | 'html' | 'schema' | 'debug';

export default function Home() {
  const [url, setUrl] = useState('');
  const [withIllustrations, setWithIllustrations] = useState(false);
  const [state, setState] = useState<AppState>({ status: 'idle' });
  const [activeTab, setActiveTab] = useState<Tab>('preview');
  const stepInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleRedesign() {
    if (!url.trim()) return;

    // Ensure URL has protocol
    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http')) {
      targetUrl = `https://${targetUrl}`;
    }

    setState({ status: 'loading', step: STEPS[0] });

    // Simulate step progression (cosmetic)
    let stepIndex = 0;
    stepInterval.current = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, STEPS.length - 1);
      setState((prev) =>
        prev.status === 'loading' ? { status: 'loading', step: STEPS[stepIndex] } : prev
      );
    }, 8000);

    try {
      const response = await fetch('/api/redesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, withIllustrations }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details?.join(', ') || `Request failed (${response.status})`);
      }

      setState({ status: 'success', data });
      setActiveTab('preview');
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong',
      });
    } finally {
      if (stepInterval.current) {
        clearInterval(stepInterval.current);
        stepInterval.current = null;
      }
    }
  }

  function handleDownload() {
    if (state.status !== 'success') return;
    const blob = new Blob([state.data.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'redesign.html';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopyHtml() {
    if (state.status !== 'success') return;
    navigator.clipboard.writeText(state.data.html);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">AI Website Redesign</h1>
          <span className="text-xs text-gray-400">POC v1.0</span>
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

          <div className="mt-3 flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
              <input
                type="checkbox"
                checked={withIllustrations}
                onChange={(e) => setWithIllustrations(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                disabled={state.status === 'loading'}
              />
              Generate illustrations (requires Recraft API key)
            </label>
          </div>
        </div>

        {/* Loading State */}
        {state.status === 'loading' && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center mb-6">
            <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-700 font-medium">{state.step}</p>
            <p className="text-gray-400 text-sm mt-2">This usually takes 30-90 seconds</p>
          </div>
        )}

        {/* Error State */}
        {state.status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
            <p className="text-red-800 font-medium">Error</p>
            <p className="text-red-600 mt-1">{state.message}</p>
          </div>
        )}

        {/* Results */}
        {state.status === 'success' && (
          <div>
            {/* Tab Bar */}
            <div className="flex items-center justify-between mb-4">
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

                  {/* Design Direction */}
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Design Direction (Gemini)</h3>
                    <pre className="font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-auto max-h-96">
                      {JSON.stringify(state.data.direction, null, 2)}
                    </pre>
                  </div>

                  {/* Tokens */}
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
                              {value.startsWith('#') ? (
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
