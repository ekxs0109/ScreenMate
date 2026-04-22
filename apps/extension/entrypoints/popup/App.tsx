import "./popup.css";
import { buildScreenMateViewerRoomUrl } from "../../lib/config";
import { useHostControls } from "./useHostControls";
import { getPopupViewModel } from "./view-model";

function formatRoomLifecycle(roomLifecycle: string) {
  switch (roomLifecycle) {
    case "opening":
      return "Opening";
    case "open":
      return "Open";
    case "degraded":
      return "Degraded";
    case "closed":
      return "Closed";
    case "idle":
    default:
      return "Idle";
  }
}

function formatSourceState(sourceState: string) {
  switch (sourceState) {
    case "unattached":
      return "No video attached";
    case "attaching":
      return "Attaching";
    case "attached":
      return "Attached";
    case "recovering":
      return "Recovering";
    case "missing":
      return "No video attached";
    default:
      return sourceState;
  }
}

function App() {
  const {
    snapshot,
    videos,
    selectedVideoId,
    setSelectedVideoId,
    startOrAttach,
    stopRoom,
    isBusy,
    busyAction,
  } = useHostControls();
  const viewModel = getPopupViewModel(snapshot);
  const viewerRoomUrl = snapshot.roomId
    ? buildScreenMateViewerRoomUrl(snapshot.roomId)
    : null;
  const primaryActionLabel =
    isBusy && busyAction === "primary" ? "Working..." : viewModel.primaryActionLabel;
  const stopActionLabel =
    isBusy && busyAction === "stop" ? "Stopping room..." : "Stop room";

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <h1>ScreenMate</h1>
        <p className="popup-status-text">{viewModel.statusText}</p>
      </header>
      <div className="popup-status-grid">
        <div className="popup-status-card">
          <p className="popup-label">Room status</p>
          <p>{formatRoomLifecycle(snapshot.roomLifecycle)}</p>
        </div>
        <div className="popup-status-card">
          <p className="popup-label">Video status</p>
          <p>{formatSourceState(snapshot.sourceState)}</p>
        </div>
      </div>
      <p className="popup-label">Room ID</p>
      <p>{snapshot.roomId ?? "Not started"}</p>
      <p className="popup-label">Viewer URL</p>
      {viewerRoomUrl ? (
        <a
          className="popup-link"
          href={viewerRoomUrl}
          rel="noreferrer"
          target="_blank"
        >
          {viewerRoomUrl}
        </a>
      ) : (
        <p>Not started</p>
      )}
      <p className="popup-label">Viewers</p>
      <p>{snapshot.viewerCount}</p>
      <p className="popup-label">Attached video</p>
      <p>{snapshot.sourceLabel ?? "No video attached"}</p>
      <p className="popup-label">Page Videos</p>
      {videos.length > 0 ? (
        <div className="popup-videos" role="radiogroup" aria-label="Page videos">
          {videos.map((video) => (
            <label
              className="popup-video"
              key={`${video.frameId}:${video.id}`}
            >
              <input
                checked={selectedVideoId === `${video.frameId}:${video.id}`}
                name="selected-video"
                onChange={() =>
                  setSelectedVideoId(`${video.frameId}:${video.id}`)
                }
                type="radio"
              />
              <span>{video.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <p>No video elements found on this page.</p>
      )}
      {snapshot.message ? (
        <p className="popup-error">{snapshot.message}</p>
      ) : null}
      <div className="popup-actions">
        <button
          disabled={isBusy || !selectedVideoId}
          onClick={() => startOrAttach()}
        >
          {primaryActionLabel}
        </button>
        <button
          className="popup-secondary-button"
          disabled={isBusy || !viewModel.canStop}
          onClick={() => stopRoom()}
        >
          {stopActionLabel}
        </button>
      </div>
    </main>
  );
}

export default App;
