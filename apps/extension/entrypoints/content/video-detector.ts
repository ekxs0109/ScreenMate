export function collectVisibleVideos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll("video"))
    .filter((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
    });
}
