import { FormEvent, useState } from "react";

export function JoinForm({
  isBusy,
  onJoin,
}: {
  isBusy: boolean;
  onJoin: (roomCode: string) => void;
}) {
  const [roomCode, setRoomCode] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onJoin(roomCode.trim());
  }

  return (
    <form className="viewer-form" onSubmit={handleSubmit}>
      <label htmlFor="roomCode">Room code</label>
      <input
        id="roomCode"
        value={roomCode}
        onChange={(event) => setRoomCode(event.target.value)}
        placeholder="room_ab12cd34"
      />
      <button disabled={isBusy} type="submit">
        {isBusy ? "Joining..." : "Join room"}
      </button>
    </form>
  );
}
