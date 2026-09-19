import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ImagePlus, Sparkles, UploadCloud } from 'lucide-react';
import { getGetNetworkNodesQueryKey, useClassifyChestXray, useGetNetworkNodes, type ClassifyChestXrayResult } from '@workspace/api-client-react';
import { PageFrame, Panel, QueryState } from '@/components/app-shell';
import { useToast } from '@/hooks/use-toast';

const CHEST_XRAY_TRACK = 'chest-xray';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:image/png;base64," prefix — the API wants raw base64.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export default function Inference() {
  const { toast } = useToast();
  const nodes = useGetNetworkNodes(
    { track: CHEST_XRAY_TRACK },
    { query: { queryKey: getGetNetworkNodesQueryKey({ track: CHEST_XRAY_TRACK }) } },
  );
  const classify = useClassifyChestXray();

  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [nodeId, setNodeId] = useState<string>('');
  const [nodeApiKey, setNodeApiKey] = useState<string>('');
  const [result, setResult] = useState<ClassifyChestXrayResult>();

  const onFileChange = (selected: File | undefined) => {
    setFile(selected);
    setResult(undefined);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(selected ? URL.createObjectURL(selected) : undefined);
  };

  const submit = async () => {
    if (!file) return;
    try {
      const imageBase64 = await fileToBase64(file);
      classify.mutate(
        { data: { imageBase64, nodeId: nodeId || null, nodeApiKey: nodeId ? nodeApiKey : null } },
        {
          onSuccess: (data) => {
            setResult(data);
            void nodes.refetch();
          },
          onError: (error) => {
            toast({
              title: 'Could not classify this image',
              description: error instanceof Error ? error.message : 'The inference call failed — a model may not be trained/imported yet.',
              variant: 'destructive',
            });
          },
        },
      );
    } catch {
      toast({ title: 'Could not read that file', description: 'Try a different image.', variant: 'destructive' });
    }
  };

  return (
    <PageFrame
      eyebrow="Chest X-ray track / real model inference"
      title="Try the trained model"
      description="Upload a chest X-ray image and run a real forward pass through the model trained by ml/federation-engine — not a simulation, an actual ONNX export of the FedAvg-aggregated weights. Optionally assign the image to a hospital node: this increments that site's real data volume and logs a real event. The image itself is never stored, only the result."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)] fade-up-2">
        <Panel label="Upload" title="Chest X-ray image">
          <div className="space-y-4 p-5 sm:p-7">
            <label
              htmlFor="xray-upload"
              className="flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-border bg-muted/30 p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
            >
              {previewUrl ? (
                <img src={previewUrl} alt="Selected chest X-ray" className="max-h-[200px] rounded-md object-contain" />
              ) : (
                <>
                  <ImagePlus size={28} className="text-muted-foreground" />
                  <p className="text-sm font-semibold">Click to choose an image</p>
                  <p className="text-xs text-muted-foreground">PNG or JPEG — any real chest X-ray, or any image to see how the model responds</p>
                </>
              )}
            </label>
            <input
              id="xray-upload"
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => onFileChange(e.target.files?.[0])}
              data-testid="input-xray-file"
            />

            <div>
              <label className="mono-label mb-1.5 block text-muted-foreground">Assign to a hospital (optional)</label>
              <select
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs outline-none ring-primary transition focus:ring-2"
                data-testid="select-assign-node"
              >
                <option value="">Don't assign — just classify</option>
                {(nodes.data ?? []).map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name} ({node.dataVolume.toLocaleString()} samples)
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                {nodeId ? 'This will increase that site\'s data volume by one and log a real activity event.' : 'No hospital will be updated — this is a one-off classification.'}
              </p>
            </div>

            {nodeId && (
              <div>
                <label className="mono-label mb-1.5 block text-muted-foreground">Hospital API key</label>
                <input
                  type="text"
                  value={nodeApiKey}
                  onChange={(e) => setNodeApiKey(e.target.value)}
                  placeholder="Paste this hospital's real credential"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-xs outline-none ring-primary transition focus:ring-2"
                  data-testid="input-node-api-key"
                />
                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                  Real per-hospital credential check, not decorative: the server verifies this against that node's stored key hash and rejects the upload with a 403 if it's missing or wrong — a genuine hospital's own systems would hold this key, not a shared browser session. For local testing, find each site's key in the output of <code className="rounded bg-muted px-1 py-0.5">pnpm run seed</code> or <code className="rounded bg-muted px-1 py-0.5">pnpm run issue-node-keys</code>.
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={!file || classify.isPending || (Boolean(nodeId) && !nodeApiKey)}
              onClick={submit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-classify"
            >
              <UploadCloud size={14} />
              {classify.isPending ? 'Running the model…' : 'Classify'}
            </button>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel label="Result" title="Model prediction">
            <QueryState loading={classify.isPending} error={false} empty={!result && !classify.isPending}>
              {result && (
                <div className="space-y-5 p-5">
                  <div className={`flex items-center gap-3 rounded-md border p-4 ${result.prediction === 'pneumonia' ? 'border-accent/40 bg-accent/10' : 'border-primary/30 bg-primary/10'}`}>
                    {result.prediction === 'pneumonia' ? <AlertTriangle size={20} className="text-accent-foreground" /> : <CheckCircle2 size={20} className="text-primary" />}
                    <div>
                      <p className="text-sm font-semibold capitalize">{result.prediction}</p>
                      <p className="text-xs text-muted-foreground">{Math.round(result.confidence * 100)}% confidence</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <ProbabilityBar label="Normal" value={result.normalProbability} />
                    <ProbabilityBar label="Pneumonia" value={result.pneumoniaProbability} />
                  </div>

                  {result.assignedNodeName && (
                    <div className="flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-xs text-primary">
                      <Sparkles size={14} className="mt-0.5 shrink-0" />
                      Assigned to <strong>{result.assignedNodeName}</strong> — its data volume just increased by one.
                    </div>
                  )}

                  <p className="font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">Model / {result.modelVersion}</p>
                </div>
              )}
            </QueryState>
          </Panel>

          <Panel label="Read this first" title="What this actually is">
            <div className="space-y-3 p-5 text-xs leading-5 text-muted-foreground">
              <p>This is a real forward pass through a real small CNN trained via genuine FedAvg over 3 simulated hospital clients on the public PneumoniaMNIST dataset — see the Knowledge Center's federated-learning module for exactly what's real and what isn't.</p>
              <p><strong className="text-foreground">This is not a diagnostic device.</strong> It is a research model trained on a small, low-resolution academic dataset. Never use this output to inform any real medical decision.</p>
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}

function ProbabilityBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{Math.round(value * 100)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(value * 100, 100)}%` }} />
      </div>
    </div>
  );
}
