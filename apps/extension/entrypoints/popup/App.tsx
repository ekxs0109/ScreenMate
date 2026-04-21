import "./popup.css";
import { useHostControls } from "./useHostControls";

function App() {
  const { snapshot, startSharing, stopSharing } = useHostControls();

  return (
    <main className="popup-shell">
      <h1>ScreenMate</h1>
      <p>Status: {snapshot.status}</p>
      <p>Room: {snapshot.roomId ?? "Not started"}</p>
      <p>Viewers: {snapshot.viewerCount}</p>
      <button onClick={() => startSharing()}>Start sharing</button>
      <button onClick={() => stopSharing()}>Stop sharing</button>
    </main>
  );
}

export default App;
