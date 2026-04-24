import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Check,
  Copy,
  ExternalLink,
  Hash,
  Info,
  Key,
  Link as LinkIcon,
  MessageCircle,
  Monitor,
  MonitorUp,
  Moon,
  Play,
  RefreshCw,
  Search,
  Send,
  Sun,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/utils";
import type { ExtensionDictionary } from "./i18n";
import type { ExtensionSceneModel, PopupTab, SourceType } from "./scene-model";

export function ExtensionPopupPresenter({
  windowMode,
  scene,
  copy,
  themeMode,
  resolvedThemeMode,
  sniffScrollTop,
  onThemeToggle,
  onOpenPopout,
  onSelectTab,
  onSelectSourceType,
  onSelectSource,
  onPreviewSource,
  onClearSourcePreview,
  onRefreshSniff,
  onSniffScrollChange,
  onToggleScreenReady,
  onStartOrAttach,
  onStopRoom,
  onSavePassword,
  onPasswordChange,
  onCopyLink,
  onCopyRoomId,
  onJumpToRoom,
  onSendChat,
}: {
  windowMode: "popup" | "popout";
  scene: ExtensionSceneModel;
  copy: ExtensionDictionary;
  themeMode: "light" | "dark" | "system";
  resolvedThemeMode: "light" | "dark";
  sniffScrollTop: number;
  onThemeToggle: () => void;
  onOpenPopout: () => void;
  onSelectTab: (tab: PopupTab) => void;
  onSelectSourceType: (kind: SourceType) => void;
  onSelectSource: (id: string) => void;
  onPreviewSource: (id: string) => void;
  onClearSourcePreview: () => void;
  onRefreshSniff: () => void;
  onSniffScrollChange: (scrollTop: number) => void;
  onToggleScreenReady: () => void;
  onStartOrAttach: () => void;
  onStopRoom: () => void;
  onSavePassword: () => void;
  onPasswordChange: (value: string) => void;
  onCopyLink: () => void;
  onCopyRoomId: () => void;
  onJumpToRoom: () => void;
  onSendChat: (text: string) => void;
}) {
  const shouldShowMetaMessage =
    scene.meta.message !== null && scene.meta.message !== "Room closed.";
  const [collapsedSniffGroupIds, setCollapsedSniffGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const themeIcon =
    themeMode === "system" ? (
      <Monitor className="w-4 h-4" />
    ) : themeMode === "dark" ? (
      <Moon className="w-4 h-4" />
    ) : (
      <Sun className="w-4 h-4" />
    );
  const themeTriggerClassName =
    themeMode === "system"
      ? "text-muted-foreground"
      : resolvedThemeMode === "dark"
        ? "text-amber-400"
        : "text-sky-600";
  const toggleSniffGroup = (groupId: string) => {
    setCollapsedSniffGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  return (
    <main
      className={cn(
        "bg-card text-card-foreground flex min-h-0 flex-col border border-border/80 overflow-hidden",
        windowMode === "popup"
          ? "h-[600px] w-[400px]"
          : "h-[min(600px,calc(100dvh-2rem))] w-[min(400px,calc(100vw-2rem))] rounded-2xl shadow-2xl",
      )}
    >
      <header className="shrink-0 flex items-center justify-between p-4 border-b border-border bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur">
        <span className="font-bold text-lg tracking-tight">{copy.appName}</span>
        <div className="flex items-center gap-1.5">
          <button
            aria-label={copy.themeLabel}
            className={cn(
              "p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-border bg-white dark:bg-zinc-900 shadow-sm flex items-center justify-center h-8 w-8",
              themeTriggerClassName,
            )}
            onClick={onThemeToggle}
            title={copy.themeLabel}
            type="button"
          >
            {themeIcon}
          </button>
          <button
            className="p-1.5 text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-border bg-white dark:bg-zinc-900 shadow-sm flex items-center justify-center h-8 w-8"
            onClick={onOpenPopout}
            title={copy.popout}
            type="button"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </header>

      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        value={scene.tabs.active}
        onValueChange={(value) => onSelectTab(value as PopupTab)}
      >
        <TabsList className="mx-3 mt-3 shrink-0 h-auto justify-start gap-3 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger className="rounded-none border-b-[3px] border-transparent px-4 pb-2.5 pt-0 text-sm font-semibold shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="source">
            {copy.tabSource}
          </TabsTrigger>
          <TabsTrigger className="rounded-none border-b-[3px] border-transparent px-4 pb-2.5 pt-0 text-sm font-semibold shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="room">
            {copy.tabRoom}
            {scene.tabs.hasShared && <span className="ml-2 inline-block size-2 rounded-full bg-green-500 animate-pulse" />}
          </TabsTrigger>
          {scene.tabs.hasShared && (
            <TabsTrigger className="rounded-none border-b-[3px] border-transparent px-4 pb-2.5 pt-0 text-sm font-semibold shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="chat">
              {copy.tabChat}
            </TabsTrigger>
          )}
        </TabsList>

        <div className="min-h-0 flex-1 overflow-hidden">
          <TabsContent value="source" className="mt-0 h-full outline-none">
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 p-4 pb-0">
                <div className="p-1 bg-zinc-100 dark:bg-zinc-900/50 rounded-lg flex items-center shadow-inner">
                  <SourceTypeButton active={scene.sourceTab.activeSourceType === "sniff"} icon={<Search className="w-3.5 h-3.5 shrink-0" />} label={copy.sourceSniff} onClick={() => onSelectSourceType("sniff")} />
                  <SourceTypeButton active={scene.sourceTab.activeSourceType === "screen"} icon={<MonitorUp className="w-3.5 h-3.5 shrink-0" />} label={copy.sourceScreen} onClick={() => onSelectSourceType("screen")} />
                  <SourceTypeButton active={scene.sourceTab.activeSourceType === "upload"} icon={<UploadCloud className="w-3.5 h-3.5 shrink-0" />} label={copy.sourceUpload} onClick={() => onSelectSourceType("upload")} />
                </div>
              </div>
              {scene.sourceTab.activeSourceType === "sniff" ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="shrink-0 px-4 pb-3 pt-4">
                    <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground px-1">
                    <div className="flex items-center gap-1.5 uppercase tracking-wider">
                      <LinkIcon className="w-3.5 h-3.5" />
                      {copy.detected}
                    </div>
                    <button onClick={onRefreshSniff} className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 transition px-2 py-1 bg-blue-50 dark:bg-blue-900/20 rounded disabled:opacity-70" type="button" disabled={scene.sourceTab.isRefreshing}>
                      <RefreshCw className={cn("w-3.5 h-3.5", scene.sourceTab.isRefreshing && "animate-spin")} />
                      <span>{copy.refreshSniff}</span>
                    </button>
                    </div>
                  </div>
                  <PopupScrollArea
                    className="min-h-0 flex-1"
                    contentClassName="px-4 pb-4 flex flex-col gap-4 min-h-full"
                    initialScrollTop={sniffScrollTop}
                    onScrollTopChange={onSniffScrollChange}
                  >
                    <div className="flex flex-col gap-4">
                      {scene.sourceTab.sniffGroups.length > 0 ? scene.sourceTab.sniffGroups.map((group) => (
                        <section key={group.id} className="flex flex-col gap-2">
                          {(() => {
                            const isCollapsed = collapsedSniffGroupIds.has(group.id);
                            return (
                              <>
                                <button
                                  aria-expanded={!isCollapsed}
                                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[11px] font-bold text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                                  onClick={() => toggleSniffGroup(group.id)}
                                  type="button"
                                >
                                  {isCollapsed ? (
                                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="size-1.5 rounded-full bg-blue-500" />
                                  <span className="min-w-0 flex-1 truncate" title={group.title}>{group.title}</span>
                                  <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{group.cards.length}</span>
                                </button>
                                {!isCollapsed && (
                                  group.cards.length > 0 ? group.cards.map((card) => (
                            <button
                              key={card.id}
                              type="button"
                              onClick={() => onSelectSource(card.id)}
                              onPointerEnter={() => onPreviewSource(card.id)}
                              onPointerLeave={onClearSourcePreview}
                              className={cn(
                                "relative overflow-hidden rounded-lg border transition-all cursor-pointer group flex bg-zinc-50 dark:bg-zinc-900/40 text-left w-full",
                                card.selected ? "border-blue-600 dark:border-blue-500 shadow-sm ring-1 ring-blue-500/15" : "border-border/60 hover:border-blue-500/50",
                              )}
                            >
                              <div className="h-16 w-24 shrink-0 overflow-hidden relative bg-black">
                                {card.thumb ? (
                                  <img
                                    alt={card.title}
                                    className="h-full w-full object-cover opacity-90"
                                    src={card.thumb}
                                    onError={(event) => {
                                      event.currentTarget.style.display = "none";
                                    }}
                                  />
                                ) : (
                                  <div className="absolute inset-0 bg-black" />
                                )}
                                {card.thumb && (
                                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Play className="w-4 h-4 text-white drop-shadow-md ml-0.5" />
                                  </div>
                                )}
                              </div>
                              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2 pr-9">
                                <p className="truncate text-xs font-bold leading-tight text-foreground" title={card.label}>{card.title}</p>
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate text-[10px] text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-[1px] rounded font-semibold border border-blue-200 dark:border-blue-800/40">
                                    {card.format}
                                  </span>
                                  <span className="shrink-0 text-[10px] text-muted-foreground font-mono">{card.rate}</span>
                                </div>
                              </div>
                              {card.selected && (
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 size-5 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center shadow-sm">
                                  <Check className="w-3 h-3 text-white" />
                                </div>
                              )}
                            </button>
                                  )) : (
                                    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                                      {copy.noVideo}
                                    </div>
                                  )
                                )}
                              </>
                            );
                          })()}
                        </section>
                      )) : (
                        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                          {copy.noVideo}
                        </div>
                      )}
                    </div>
                  </PopupScrollArea>
                </div>
              ) : (
                <div className="min-h-0 flex-1 p-4">
                  {scene.sourceTab.activeSourceType === "screen" && (
                  <div className="flex flex-col gap-4 flex-1 pb-6">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                      <MonitorUp className="w-3.5 h-3.5" />
                      {copy.sourceScreen}
                    </div>
                    <div className={cn("border-2 border-dashed rounded-xl aspect-[4/3] flex flex-col items-center justify-center p-6 gap-4 text-center transition-colors group", scene.sourceTab.screenReady ? "border-green-500/50 bg-green-50/30 dark:bg-green-900/10" : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-900/50 bg-zinc-50/30 dark:bg-zinc-900/10")}>
                      <div className={cn("size-16 rounded-full flex items-center justify-center transition-all shadow-sm", scene.sourceTab.screenReady ? "bg-green-100 dark:bg-green-900/30" : "bg-indigo-50 dark:bg-indigo-500/10")}>
                        {scene.sourceTab.screenReady ? <Check className="w-8 h-8 text-green-600 dark:text-green-500" /> : <MonitorUp className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />}
                      </div>
                      <div>
                        {!scene.sourceTab.screenReady ? (
                          <>
                            <p className="text-[14px] font-bold text-foreground mb-1">{copy.captureTitle}</p>
                            <p className="text-xs text-muted-foreground mb-5 font-medium leading-relaxed max-w-[240px] mx-auto">{copy.captureDescription}</p>
                            <button className="py-2.5 px-6 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-black font-semibold rounded-lg shadow-sm transition-colors text-sm" onClick={onToggleScreenReady} type="button">
                              {copy.captureButton}
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="text-[15px] font-bold text-green-600 dark:text-green-400 mb-1">{copy.screenReady}</p>
                            <p className="text-xs text-muted-foreground mb-5 font-medium leading-relaxed max-w-[240px] mx-auto">{copy.screenReadyDescription}</p>
                            <button className="py-2 px-4 bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900 text-foreground font-semibold rounded-lg border border-border shadow-sm transition-colors text-xs" onClick={onToggleScreenReady} type="button">
                              {copy.reselect}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  )}

                  {scene.sourceTab.activeSourceType === "upload" && (
                  <div className="flex flex-col gap-4 flex-1 pb-6">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                      <UploadCloud className="w-3.5 h-3.5" />
                      {copy.sourceUpload}
                    </div>
                    <div className="border-2 border-dashed border-border rounded-xl aspect-[4/3] flex flex-col items-center justify-center p-8 gap-5 text-center bg-zinc-50/30 dark:bg-zinc-900/10">
                      <div className="size-16 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shadow-sm">
                        <UploadCloud className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-[15px] font-bold text-foreground">{copy.uploadDropzone}</p>
                        <p className="text-xs text-muted-foreground mt-2 font-medium">.mp4, .webm, .mkv / Max 2GB</p>
                      </div>
                    </div>
                  </div>
                  )}
                </div>
              )}
              {shouldShowMetaMessage && (
                <div className="shrink-0 px-4 pb-3">
                  <div className="rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border border-red-100 dark:border-red-500/20 p-3 text-xs shadow-sm">
                    {scene.meta.message}
                  </div>
                </div>
              )}
              <div className="shrink-0 border-t border-border bg-card/95 p-4 backdrop-blur-md">
                {!scene.tabs.hasShared ? (
                  <button onClick={onStartOrAttach} className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-50" disabled={scene.footer.primaryDisabled} type="button">
                    <Play className="w-4 h-4 fill-current" />
                    {copy.generateShare}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 w-full">
                    <button onClick={() => onSelectTab("room")} className="flex-1 py-3.5 px-4 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900/80 dark:hover:bg-zinc-800 text-sm font-bold rounded-xl transition-colors border border-transparent flex items-center justify-center text-foreground" type="button">
                      {copy.cancel}
                    </button>
                    <button onClick={() => onSelectTab("room")} className="flex-1 py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2" type="button">
                      <RefreshCw className="w-4 h-4" />
                      {copy.changeSource}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="room" className="mt-0 h-full outline-none">
            <div className="flex h-full min-h-0 flex-col">
              <PopupScrollArea className="min-h-0 flex-1" contentClassName="p-4 flex flex-col gap-6">
                {!scene.tabs.hasShared ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 opacity-70 px-8 py-20 min-h-[400px]">
                    <div className="size-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-2">
                      <Info className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">{copy.notSharedYet}</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-white dark:bg-zinc-900 border border-border rounded-xl shadow-sm text-sm overflow-hidden">
                      <div className="p-3 border-b border-border bg-zinc-50/50 dark:bg-zinc-950/50 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Hash className="w-4 h-4 text-blue-500" />
                          <span className="font-bold">{copy.roomId}: {scene.roomTab.roomId}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="rounded-md p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800" onClick={onCopyRoomId} type="button">
                            <Copy className="w-4 h-4" />
                          </button>
                          <button className="text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1.5 hover:underline" onClick={onJumpToRoom} type="button">
                            {copy.openRoom} <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div className="p-3 flex flex-col gap-4">
                        <div className="relative">
                          <input readOnly type="text" value={scene.roomTab.shareUrl ?? ""} className="w-full bg-zinc-100 dark:bg-zinc-950 border border-border rounded-lg pl-3 pr-10 py-2.5 text-xs font-mono text-muted-foreground outline-none truncate" />
                          <button className="absolute right-1.5 top-1.5 p-1 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 text-muted-foreground transition-colors" onClick={onCopyLink} type="button">
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="size-7 flex items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 shrink-0 border border-border shadow-sm">
                            <Key className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <input
                            type="text"
                            value={scene.roomTab.passwordDraft}
                            onChange={(event) => onPasswordChange(event.target.value)}
                            placeholder={copy.passwordPlaceholder}
                            className="flex-1 bg-transparent border-b border-border px-1 py-1.5 text-xs font-medium focus:border-blue-500 focus:outline-none transition-colors dark:text-zinc-200"
                          />
                          <button
                            onClick={onSavePassword}
                            type="button"
                            className={cn("text-xs px-3 py-1.5 rounded-lg font-bold transition-colors shadow-sm whitespace-nowrap", scene.roomTab.passwordSaved ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800/50" : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 border border-transparent")}
                          >
                            {scene.roomTab.passwordSaved ? copy.saved : copy.save}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-zinc-900 border border-border rounded-xl shadow-sm text-sm overflow-hidden flex flex-col">
                      <div className="p-3 border-b border-border bg-zinc-50/50 dark:bg-zinc-950/50 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-blue-500" />
                          <span className="font-bold">{copy.viewerList}</span>
                        </div>
                        <span className="px-2 py-0.5 rounded-full bg-blue-100/80 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-bold border border-blue-200 dark:border-blue-800/30">
                          {scene.roomTab.viewerDetails.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-[1fr_70px_50px] gap-2 px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider items-center border-b border-border/50 bg-zinc-50 dark:bg-zinc-900/30">
                        <span>{copy.viewerName}</span>
                        <span className="text-center">{copy.connType}</span>
                        <span className="text-right flex items-center justify-end gap-1">
                          <Activity className="w-2.5 h-2.5" />
                          {copy.connPing}
                        </span>
                      </div>
                      <div className="divide-y divide-border/50">
                        {scene.roomTab.viewerDetails.map((viewer) => (
                          <div key={viewer.id} className="grid grid-cols-[1fr_70px_50px] gap-2 px-3 py-2.5 items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <div className="font-bold text-xs flex items-center gap-2 min-w-0 pr-1">
                              <div className="size-1.5 rounded-full bg-green-500 shrink-0" />
                              <span className="truncate">{viewer.name}</span>
                            </div>
                            <div className="flex justify-center">
                              <span className="text-[9px] font-bold text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md border border-border whitespace-nowrap">
                                {viewer.connType}
                              </span>
                            </div>
                            <div className={cn("font-mono font-bold text-[11px] text-right", viewer.isGood ? "text-green-600 dark:text-green-400" : "text-amber-500")}>
                              {viewer.ping}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </PopupScrollArea>
              {scene.tabs.hasShared && (
                <div className="shrink-0 border-t border-border bg-card/95 p-4 backdrop-blur-md">
                  <button onClick={onStopRoom} className="w-full py-3.5 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-900/50 rounded-xl font-bold transition-colors text-sm flex items-center justify-center gap-2 shadow-sm disabled:opacity-50" disabled={scene.footer.secondaryDisabled} type="button">
                    <X className="w-4 h-4 stroke-[3]" />
                    {copy.endShare}
                  </button>
                </div>
              )}
            </div>
          </TabsContent>

          {scene.tabs.hasShared && (
            <TabsContent value="chat" className="mt-0 h-full outline-none">
              <div className="flex h-full min-h-0 flex-col">
                <ChatPane messages={scene.chatTab.messages} onSend={onSendChat} placeholder={copy.chatPlaceholder} />
              </div>
            </TabsContent>
          )}
        </div>
      </Tabs>
    </main>
  );
}

function SourceTypeButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold rounded-md transition-all border", active ? "bg-white dark:bg-zinc-800 shadow-sm border-zinc-200 dark:border-zinc-700 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function ChatPane({ messages, onSend, placeholder }: { messages: ExtensionSceneModel["chatTab"]["messages"]; onSend: (text: string) => void; placeholder: string }) {
  return <ChatPaneInner messages={messages} onSend={onSend} placeholder={placeholder} roundedBottom />;
}

export function ContentChatWidget({
  messages,
  onSend,
  minimized,
  onToggleMinimized,
  title,
  placeholder,
}: {
  messages: ExtensionSceneModel["chatTab"]["messages"];
  onSend: (text: string) => void;
  minimized: boolean;
  onToggleMinimized: () => void;
  title: string;
  placeholder: string;
}) {
  return (
    <div className={cn("fixed bottom-6 left-6 z-[2147483646] bg-card border border-border shadow-2xl rounded-2xl overflow-hidden transition-all duration-300 flex flex-col font-sans hover:shadow-blue-500/10", minimized ? "w-48 h-12 cursor-pointer opacity-90 hover:opacity-100" : "w-[340px] h-[480px]")}>
      <div className="p-3 border-b border-border bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between shrink-0 cursor-pointer" onClick={onToggleMinimized}>
        <div className="flex items-center gap-2.5 px-1">
          <MessageCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="font-bold text-sm tracking-tight">{title}</span>
        </div>
        {minimized ? <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse mr-2" /> : <span className="w-7 h-7 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-md flex items-center justify-center transition-colors"><X className="w-4 h-4 text-muted-foreground stroke-[3]" /></span>}
      </div>
      {!minimized && <ChatPaneInner messages={messages} onSend={onSend} placeholder={placeholder} />}
    </div>
  );
}

function ChatPaneInner({ messages, onSend, placeholder, roundedBottom = false }: { messages: ExtensionSceneModel["chatTab"]["messages"]; onSend: (text: string) => void; placeholder: string; roundedBottom?: boolean }) {
  return (
    <>
      <PopupScrollArea
        className="flex-1"
        contentClassName="p-4 flex flex-col gap-4 relative bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] dark:bg-none min-h-full"
      >
        {messages.map((message) => (
          <div key={message.id} className="flex flex-col gap-1">
            <span className={cn("text-[10px] font-bold tracking-wide uppercase", message.sender === "System" ? "text-gray-400" : "text-blue-500")}>
              {message.sender}
            </span>
            <p className={cn("text-sm px-3.5 py-2 rounded-2xl w-max max-w-[90%] shadow-sm leading-relaxed", message.sender === "System" ? "bg-transparent text-gray-500 italic px-0 shadow-none" : "bg-white dark:bg-zinc-900 text-foreground border border-border")}>
              {message.text}
            </p>
          </div>
        ))}
      </PopupScrollArea>
      <form
        className={cn("p-3 border-t border-border bg-card flex gap-2 shrink-0", roundedBottom && "pb-6 rounded-b-2xl")}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const value = String(formData.get("message") ?? "").trim();
          if (!value) {
            return;
          }
          onSend(value);
          event.currentTarget.reset();
        }}
      >
        <input
          name="message"
          type="text"
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-zinc-100 dark:bg-zinc-900 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-medium"
        />
        <button type="submit" className="w-12 bg-blue-600 text-white rounded-xl flex items-center justify-center transition-opacity shadow-sm shrink-0">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </>
  );
}

function PopupScrollArea({
  children,
  className,
  contentClassName,
  initialScrollTop = 0,
  onScrollTopChange,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasRestoredScrollRef = useRef(false);

  useEffect(() => {
    if (hasRestoredScrollRef.current) {
      return;
    }

    const node = containerRef.current;
    if (node) {
      node.scrollTop = initialScrollTop;
      hasRestoredScrollRef.current = true;
    }
  }, [initialScrollTop]);

  return (
    <div
      ref={containerRef}
      className={cn("popup-scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden", className)}
      onScroll={(event) => {
        onScrollTopChange?.(event.currentTarget.scrollTop);
      }}
    >
      <div className={cn("box-border", contentClassName)}>{children}</div>
    </div>
  );
}
