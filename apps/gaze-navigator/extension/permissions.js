// Device permission is requested deliberately in the extension's own setup tab, never a visited site.
const status = document.getElementById('status');
const allow = document.getElementById('allow');
const microphone = new URLSearchParams(location.search).get('device') === 'microphone';
const device = microphone ? 'microphone' : 'camera';
if (microphone) {
  document.title = 'Allow the microphone for Gaze Navigator';
  document.querySelector('h1').textContent = document.title;
  document.getElementById('description').textContent = 'Gaze Navigator listens for your spoken instructions. Microphone access belongs to this extension, not each website you visit. Listening starts only when you return and choose Start listening.';
  document.getElementById('privacy').textContent = 'Chrome speech recognition may send microphone audio to the browser vendor’s service. Gaze Navigator does not record or store audio or transcripts. This setup check stops the microphone immediately.';
  allow.textContent = 'Allow microphone';
}
function allowed() {
  status.textContent = microphone
    ? 'The microphone is allowed. Return to your tab and choose Start listening. If Chrome still refuses recognition, check this extension’s microphone setting; typed instructions remain available.'
    : 'The camera is allowed. Return to your tab and say “use camera”, or choose Camera in the navigator panel.';
  allow.disabled = true;
}
async function request() {
  allow.disabled = true;
  status.textContent = 'Waiting for your answer in the browser prompt…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia(microphone ? { audio: true } : { video: true });
    for (const track of stream.getTracks()) track.stop();
    allowed();
  } catch (error) {
    allow.disabled = false;
    status.textContent = error.name === 'NotAllowedError'
      ? `${microphone ? 'Microphone' : 'Camera'} access was refused. Allow it from the address bar or Chrome’s site settings for this extension, then try again.`
      : `The ${device} could not start (${error.message}). Check that a ${microphone ? 'microphone' : 'webcam'} is connected.`;
  }
}
allow.addEventListener('click', request);
navigator.permissions?.query({ name: device }).then(state => { if (state.state === 'granted') allowed(); }).catch(() => {});
