import { exportGif } from '../src/export.ts';
import { createProject, type DrawingLayer, type Project } from '../src/model.ts';

function fixture(frameCount = 12): Project {
  const project = createProject();
  project.title = 'GIF decoder fixture';
  project.frameCount = frameCount;
  project.background = '#ffffff';
  const layer = project.layers[0] as DrawingLayer;
  layer.cels[0].strokes = [{ color: '#ff0000', width: 40, points: [{ x: 0, y: 0 }] }];
  const pose = { scale: 1, rotation: 0, opacity: 1, y: 180 };
  layer.keys = [
    { ...pose, x: 100, frame: 0, easing: 'linear' },
    { ...pose, x: 540, frame: frameCount - 1, easing: 'linear' },
  ];
  return project;
}

function imageFixture(): Project {
  const project = fixture();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#0000ff';
  context.fillRect(0, 0, 16, 16);
  project.layers = [{
    id: 'image-export-fixture', name: 'Embedded image', kind: 'image',
    image: { dataUrl: canvas.toDataURL('image/png'), width: 16, height: 16 },
    keys: project.layers[0].keys,
  }];
  return project;
}

const harness = { exportGif, fixture, imageFixture };
declare global { interface Window { exportHarness: typeof harness } }
window.exportHarness = harness;
document.querySelector('#ready')!.textContent = 'Actual export modules ready';
