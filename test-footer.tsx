              <div className="shrink-0 border-t border-border bg-zinc-50/90 dark:bg-zinc-950/90 p-2.5 backdrop-blur-md flex items-center gap-3">
                {effectiveSourceType === "sniff" && (
                  <label 
                    className="flex shrink-0 items-center gap-2 cursor-pointer group"
                    title={copy.followAutoDescription}
                  >
                    <div
                      className={cn(
                         "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none",
                         scene.sourceTab.followActiveTabVideo ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-600"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-sm ring-0 transition-transform",
                          scene.sourceTab.followActiveTabVideo ? "translate-x-3" : "translate-x-0"
                        )}
                      />
                    </div>
                    <span className={cn(
                      "text-[11px] font-bold select-none transition-colors",
                      scene.sourceTab.followActiveTabVideo ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground group-hover:text-foreground"
                    )}>
                      {copy.followAuto}
                    </span>
                  </label>
                )}
                
                {!(scene.tabs.hasShared && isAutoFollow) && (
                  <div className="flex-1 flex items-center gap-2 justify-end">
                    {!scene.tabs.hasShared ? (
                      <button data-testid="popup-start-or-attach" onClick={onStartOrAttach} className="flex-1 min-w-0 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none" disabled={scene.footer.primaryDisabled} type="button">
                        <Play className="w-3 h-3 fill-current shrink-0" />
                        <span className="truncate">{copy.generateShare}</span>
                      </button>
                    ) : (
                      <>
                        <button onClick={() => onSelectTab("room")} className="flex-1 min-w-0 py-2 px-2 bg-zinc-200/50 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[11px] font-bold rounded-lg transition-colors border border-transparent flex items-center justify-center text-foreground" type="button">
                          <span className="truncate">{copy.cancel}</span>
                        </button>
                        <button onClick={onStartOrAttach} className="flex-[2] min-w-0 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none" disabled={scene.footer.primaryDisabled} type="button">
                          <RefreshCw className="w-3 h-3 shrink-0" />
                          <span className="truncate">{copy.changeSource}</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
