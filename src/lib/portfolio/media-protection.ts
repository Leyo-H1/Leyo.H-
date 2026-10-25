// UI restrictions, not DRM: the browser must still receive data to play a video.
export function protectPortfolioVideo(video: HTMLVideoElement | null): void {
  if (!video || video.dataset.downloadUi === "blocked") return;
  video.dataset.downloadUi = "blocked";
  video.setAttribute("controlsList", "nodownload");
  video.draggable = false;
  const blockSave = (event: Event) => event.preventDefault();
  video.addEventListener("contextmenu", blockSave);
  video.addEventListener("dragstart", blockSave);
}
