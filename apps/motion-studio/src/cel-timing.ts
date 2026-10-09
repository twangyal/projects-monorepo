import {validateProject, type Project} from './model.ts';
export function displayedDrawingFrame(raw: string, frameCount: number): number {
  const text = raw.trim(), value = Number(text);
  if (!Number.isSafeInteger(frameCount) || frameCount < 2) throw new Error('Drawing frame count must be a positive integer timeline.');
  if (raw.length > 32 || !/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(value) || value < 2 || value > frameCount) throw new Error(`Enter an integer frame from 2 through ${frameCount}.`);
  return value - 1;
}
/** Move one complete exposure; other drawings and every pose key remain unchanged. */
export function retimeDrawingCel(input: Project, layerId: string, celFrame: number, nextFrame: number): Project {
  const project = validateProject(input), layer = project.layers.find(item => item.id === layerId);
  if (!layer || layer.kind !== 'drawing') throw new Error('Select an existing drawing layer to change drawing timing.');
  if (!Number.isInteger(celFrame) || celFrame <= 0) throw new Error('The first drawing start cannot be moved.');
  const cel = layer.cels.find(item => item.frame === celFrame);
  if (!cel) throw new Error('There is no drawing boundary at this frame.');
  if (!Number.isInteger(nextFrame) || nextFrame <= 0 || nextFrame >= project.frameCount) throw new Error('The drawing start must be within the timeline after its first frame.');
  if (nextFrame !== celFrame && layer.cels.some(item => item.frame === nextFrame)) throw new Error('A drawing already starts at that frame. Choose an unoccupied frame.');
  cel.frame = nextFrame; layer.cels.sort((a,b) => a.frame - b.frame);
  return validateProject(project);
}
