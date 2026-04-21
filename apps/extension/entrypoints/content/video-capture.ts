export function captureVideoStream(video: HTMLVideoElement): MediaStream {
  const streamableVideo = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
  };

  if (typeof streamableVideo.captureStream === "function") {
    return streamableVideo.captureStream();
  }

  throw new Error("CAPTURE_NOT_SUPPORTED");
}
