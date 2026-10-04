import { validateProject } from './model.ts';
import { decodePhoto } from './images.ts';
import { renderPixels } from './render.ts';
import { encodePng } from './png.ts';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
let received = false;
scope.onmessage = event => {
  if (received) return;
  received = true;
  void render(event.data);
};
async function render(value: unknown): Promise<void> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const input = value as Record<string, unknown>;
    if (Object.keys(input).length !== 2 || (input.kind !== 'render' && input.kind !== 'export')) throw new Error();
    const project = validateProject(input.project);
    const source = await decodePhoto(project.photo);
    const frame = renderPixels(source, project);
    if (input.kind === 'render') scope.postMessage({ kind: 'rendered', frame }, [frame.rgba.buffer as ArrayBuffer]);
    else {
      const bytes = encodePng(frame);
      scope.postMessage({ kind: 'png', bytes }, [bytes.buffer as ArrayBuffer]);
    }
  } catch { scope.postMessage({ kind: 'error' }); }
}
