import { errorCodes } from "@screenmate/shared";

export function captureVideoStream(video: HTMLVideoElement): MediaStream {
  const streamableVideo = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
  };

  if (typeof streamableVideo.captureStream === "function") {
    return streamableVideo.captureStream();
  }

  throw new Error(errorCodes.CAPTURE_NOT_SUPPORTED);
}
