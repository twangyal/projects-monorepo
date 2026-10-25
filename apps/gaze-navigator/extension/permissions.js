// Asks for camera access in Gaze Navigator's own page, so the browser remembers it for the extension.
const status = document.getElementById('status');
const allow = document.getElementById('allow');

function allowed() {
  status.textContent = 'The camera is allowed. Return to your tab and say “use camera”, or choose Camera in the navigator panel.';
  allow.disabled = true;
}

async function request() {
  status.textContent = 'Waiting for your answer in the browser prompt…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    for (const track of stream.getTracks()) track.stop();
    allowed();
  } catch (error) {
    status.textContent = error.name === 'NotAllowedError'
      ? 'Camera access was refused. Allow it from the camera icon in the address bar or in Chrome’s site settings for this extension, then try again.'
      : `The camera could not start (${error.message}). Check that a webcam is connected.`;
  }
}

allow.addEventListener('click', request);
navigator.permissions?.query({ name: 'camera' }).then(state => { if (state.state === 'granted') allowed(); }).catch(() => {});
