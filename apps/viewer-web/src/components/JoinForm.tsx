import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, LogIn } from "lucide-react";
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
    <form className="grid gap-5 mt-2" onSubmit={handleSubmit}>
      <div className="grid gap-2.5">
        <Label htmlFor="roomCode" className="text-sm font-semibold text-foreground">
          {copy.roomCodeLabel}
        </Label>
        <Input
          data-testid="viewer-room-code-input"
          id="roomCode"
          value={roomCode}
          onChange={(event) => setRoomCode(event.target.value)}
          placeholder="room_ab12cd34"
          className="h-11 bg-zinc-50 dark:bg-zinc-900 border-border focus-visible:ring-1 focus-visible:ring-foreground transition-all px-4 rounded-xl"
          autoComplete="off"
          disabled={isBusy}
        />
      </div>
      <div className="grid gap-2.5">
        <Label htmlFor="roomPassword" className="text-sm font-semibold text-foreground">
          {copy.roomPasswordLabel}
        </Label>
        <Input
          data-testid="viewer-room-password-input"
          id="roomPassword"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={copy.roomPasswordPlaceholder}
          className="h-11 bg-zinc-50 dark:bg-zinc-900 border-border focus-visible:ring-1 focus-visible:ring-foreground transition-all px-4 rounded-xl"
          autoComplete="off"
          disabled={isBusy}
          type="password"
        />
      </div>

      <button
        data-testid="viewer-join-submit"
        disabled={isBusy || !roomCode.trim()}
        type="submit"
        className="group relative z-10 mt-2 flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-foreground text-sm font-semibold text-background shadow-[0_0_0_1px_rgba(255,255,255,0.1)_inset] transition-all duration-300 hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/20 to-blue-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        {isBusy ? (
          <Loader2 className="size-4 animate-spin text-background" />
        ) : (
          <LogIn className="size-4 fill-current transition-transform duration-300 group-hover:scale-110" />
        )}
        <span className="relative">{isBusy ? copy.joiningAction : copy.joinRoomAction}</span>
      </button>
    </form>
  );
}
