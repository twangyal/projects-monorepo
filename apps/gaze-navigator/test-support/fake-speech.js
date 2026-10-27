// Test-build-only recognizer. Tests execute it inside the real extension capture frame, never a website.
(() => {
  const instances = [];
  class Recognition {
    constructor() { this.starts=0; this.aborted=0; instances.push(this); }
    start() { this.starts++; this.onstart?.(); }
    abort() { this.aborted++; this.onend?.(); }
  }
  // With "gaze-fake-speech" set to "downloadable" in the extension's storage, it can also run on the device.
  if (localStorage.getItem('gaze-fake-speech') === 'downloadable') {
    let status = 'downloadable';
    Recognition.available = async () => status;
    Recognition.install = async () => { status = 'available'; return true; };
    window.SpeechRecognitionPhrase = class { constructor(phrase, boost) { this.phrase = phrase; this.boost = boost; } };
  }
  window.SpeechRecognition = Recognition;
  window.__extensionSpeech = {
    instances,
    begin() { instances.at(-1).onspeechstart?.(); },
    say(text, final = true, index = 0) {
      const results = Array.from({length:index+1}, () => Object.assign([{transcript:''}],{isFinal:true}));
      results[index] = Object.assign([{transcript:text}],{isFinal:final});
      instances.at(-1).onresult?.({resultIndex:index,results});
    },
    fail(error) { instances.at(-1).onerror?.({error}); },
  };
})();
