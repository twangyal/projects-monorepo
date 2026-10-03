interface RecognitionResult { results: ArrayLike<ArrayLike<{ transcript: string }>> }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResult) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;
declare global { interface Window {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
} }

export class VoiceConfirmation {
  private recognition: Recognition | null = null;
  get supported() { return !!(window.SpeechRecognition ?? window.webkitSpeechRecognition); }

  start(onConfirm: () => void, onEnd: (message: string) => void): boolean {
    this.stop();
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) return false;
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = event => {
      const words = event.results[event.results.length - 1][0].transcript.trim().toLowerCase().replace(/[.!?]/g, '');
      if (words === 'confirm') onConfirm();
    };
    recognition.onerror = event => { this.stop(); onEnd(`Voice stopped (${event.error}). You can use Enter or the confirm button.`); };
    recognition.onend = () => {
      if (this.recognition === recognition) { this.recognition = null; onEnd('Voice stopped. Enable it again when ready.'); }
    };
    try { recognition.start(); return true; }
    catch { this.stop(); onEnd('Voice could not start. Use Enter or the confirm button.'); return false; }
  }

  stop() {
    if (!this.recognition) return;
    const recognition = this.recognition;
    this.recognition = null;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;
    recognition.abort();
  }
}
