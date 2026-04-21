import "./popup.css";
import { useHostControls } from "./useHostControls";

function App() {
  const {
    snapshot,
    videos,
    selectedVideoId,
    setSelectedVideoId,
    startSharing,
    stopSharing,
  } = useHostControls();
  const isBusy = snapshot.status === "starting";

  return (
    <main className="popup-shell">
      <h1>ScreenMate</h1>
      <p className="popup-label">Status</p>
      <p>{snapshot.status}</p>
      <p className="popup-label">Room</p>
      <p>{snapshot.roomId ?? "Not started"}</p>
      <p className="popup-label">Viewers</p>
      <p>{snapshot.viewerCount}</p>
      <p className="popup-label">Source</p>
      <p>{snapshot.sourceLabel ?? "No source selected"}</p>
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
      {snapshot.errorMessage ? (
        <p className="popup-error">{snapshot.errorMessage}</p>
      ) : null}
      <button
        disabled={isBusy || videos.length === 0 || !selectedVideoId}
        onClick={() => startSharing()}
      >
        {isBusy ? "Starting..." : "Start sharing"}
      </button>
      <button onClick={() => stopSharing()}>Stop sharing</button>
    </main>
  );
}

export default App;
