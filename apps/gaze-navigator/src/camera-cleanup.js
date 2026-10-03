// A dependency's end() may only remove UI. Release the stream explicitly first.
export function releaseCamera(api, document) {
  const attempt = action => { try { action(); } catch { /* Partial startup may have no overlays or stream yet. */ } };
  attempt(() => {
    const id = api.params?.videoElementId ?? 'webgazerVideoFeed';
    const video = document.getElementById?.(id) ?? document.querySelector?.(`#${id}`);
    for (const track of video?.srcObject?.getTracks() ?? []) attempt(() => track.stop());
    if (video) video.srcObject = null;
  });
  // Also covers an acquired stream that was not yet attached to the video node.
  attempt(() => api.stopVideo?.());
  attempt(() => api.removeMouseEventListeners?.());
  attempt(() => api.clearGazeListener?.());
  attempt(() => api.end?.());
}
