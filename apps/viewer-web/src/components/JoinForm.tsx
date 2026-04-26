import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useViewerI18n } from "../i18n";

export function JoinForm({
  initialRoomCode = "",
  isBusy,
  onJoin,
}: {
  initialRoomCode?: string;
  isBusy: boolean;
  onJoin: (roomCode: string, password: string) => void;
}) {
  const { copy } = useViewerI18n();
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [password, setPassword] = useState("");

  useEffect(() => {
    setRoomCode(initialRoomCode);
  }, [initialRoomCode]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onJoin(roomCode.trim(), password);
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="roomCode" className="text-slate-600 dark:text-slate-300">
          {copy.roomCodeLabel}
        </Label>
        <Input
          data-testid="viewer-room-code-input"
          id="roomCode"
          value={roomCode}
          onChange={(event) => setRoomCode(event.target.value)}
          placeholder="room_ab12cd34"
          className="bg-white/50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50 focus-visible:ring-teal-500"
          autoComplete="off"
          disabled={isBusy}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="roomPassword" className="text-slate-600 dark:text-slate-300">
          {copy.roomPasswordLabel}
        </Label>
        <Input
          data-testid="viewer-room-password-input"
          id="roomPassword"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={copy.roomPasswordPlaceholder}
          className="bg-white/50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50 focus-visible:ring-teal-500"
          autoComplete="off"
          disabled={isBusy}
          type="password"
        />
      </div>
      <Button 
        data-testid="viewer-join-submit"
        disabled={isBusy || !roomCode.trim()} 
        type="submit" 
        className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white border-0"
      >
        {isBusy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {copy.joiningAction}
          </>
        ) : (
          copy.joinRoomAction
        )}
      </Button>
    </form>
  );
}
