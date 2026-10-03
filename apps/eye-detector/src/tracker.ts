import type { FaceMesh as FaceMeshType } from '@mediapipe/face_mesh';
import { eyeFeatures } from './calibration';

declare global { interface Window { FaceMesh: typeof FaceMeshType } }
interface Session {
  canceled: boolean;
  stream: MediaStream | null;
  model: FaceMeshType | null;
  pending: Promise<void> | null;
  frame: number;
}

let scriptPromise: Promise<void> | null = null;
function loadModelScript(): Promise<void> {
  if (window.FaceMesh) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      script.remove(); scriptPromise = null;
      reject(new Error('Vision model loading timed out. Reload and try again.'));
    }, 20000);
    script.src = `${import.meta.env.BASE_URL}vision/face_mesh.js`;
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => {
      clearTimeout(timeout); script.remove(); scriptPromise = null;
      reject(new Error('Could not load local vision assets. Run npm run assets and retry.'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

export class CameraTracker {
  private session: Session | null = null;
  constructor(private video: HTMLVideoElement) {}

  private closeModel(session: Session) {
    if (!session.model || session.pending) return;
    const model = session.model;
    session.model = null;
    void model.close().catch(() => { /* Camera tracks have already been stopped. */ });
  }

  stop() {
    const session = this.session;
    this.session = null;
    if (!session) return;
    session.canceled = true;
    cancelAnimationFrame(session.frame);
    session.stream?.getTracks().forEach(track => track.stop());
    this.video.srcObject = null;
    this.closeModel(session);
  }

  async start(onFeatures: (features: number[] | null) => void, onError: (error: unknown) => void): Promise<boolean> {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs localhost or HTTPS in a supported browser.');
    const session: Session = { canceled: false, stream: null, model: null, pending: null, frame: 0 };
    this.session = session;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: 640, height: 480, facingMode: 'user' } });
      if (session.canceled) { stream.getTracks().forEach(track => track.stop()); return false; }
      session.stream = stream;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (!session.canceled) { this.stop(); onError(new Error('Camera disconnected. Start it again or try simulation.')); }
      });
      this.video.srcObject = stream;
      await this.video.play();
      if (session.canceled) return false;
      await loadModelScript();
      if (session.canceled) return false;
      const model = new window.FaceMesh({ locateFile: file => `${import.meta.env.BASE_URL}vision/${file}` });
      session.model = model;
      model.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
      model.onResults(result => {
        if (!session.canceled) onFeatures(eyeFeatures(result.multiFaceLandmarks?.[0] ?? []));
      });
      session.pending = model.initialize();
      await session.pending;
      session.pending = null;
      if (session.canceled) { this.closeModel(session); return false; }
      const tick = async () => {
        if (session.canceled) return;
        try {
          session.pending = model.send({ image: this.video });
          await session.pending;
          session.pending = null;
          if (session.canceled) this.closeModel(session);
          else session.frame = requestAnimationFrame(() => { void tick(); });
        } catch (error) {
          session.pending = null;
          if (!session.canceled) { this.stop(); onError(error); }
          else this.closeModel(session);
        }
      };
      session.frame = requestAnimationFrame(() => { void tick(); });
      return true;
    } catch (error) {
      session.pending = null;
      if (session.canceled) { this.closeModel(session); return false; }
      this.stop();
      throw error;
    }
  }
}
