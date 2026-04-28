const fs = require('fs');
const file = "apps/extension/entrypoints/popup/presenter.tsx";
let code = fs.readFileSync(file, "utf8");
const oldCode = code.match(/<div className="shrink-0 border-t border-border bg-zinc-50\/90 dark:bg-zinc-950\/90 p-2\.5 backdrop-blur-md flex items-center justify-between gap-3">[\s\S]*?<\/div>[\s\S]*?<\/div>[\s\S]*?<\/TabsContent>/)[0];
console.log("length of oldCode: " + oldCode.length);
fs.writeFileSync(file, code.replace(oldCode, `<div className="shrink-0 border-t border-border bg-zinc-50/90 dark:bg-zinc-950/90 p-3 backdrop-blur-md flex flex-col gap-2.5">
                {effectiveSourceType === "sniff" && (
                  <label 
                    className="flex shrink-0 items-center justify-between group px-1 mb-0.5 cursor-pointer"
                    title={copy.followAutoDescription}
                  >
                    <span className={cn(
                      "text-[11.5px] font-semibold select-none transition-colors",
                      scene.sourceTab.followActiveTabVideo ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground group-hover:text-foreground"
                    )}>
                      {copy.followAuto}
                    </span>
                    <div
                      className={cn(
                        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none",
                        scene.sourceTab.followActiveTabVideo ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-600"
                      )}
                    >
                      <input 
                        type="checkbox" 
                        className="sr-only" 
                        checked={scene.sourceTab.followActiveTabVideo} 
                        onChange={(e) => onToggleFollowActiveTabVideo(e.target.checked)} 
                      />
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-sm ring-0 transition-transform",
                          scene.sourceTab.followActiveTabVideo ? "translate-x-3" : "translate-x-0"
                        )}
                      />
                    </div>
                  </label>
                )}
                
                {!(scene.tabs.hasShared && isAutoFollow) && (
                  <div className="flex-1 flex items-center gap-2 w-full">
                    {!scene.tabs.hasShared ? (
                      <button data-testid="popup-start-or-attach" onClick={onStartOrAttach} className="flex-1 min-w-0 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition-[background-color,transform,box-shadow] shadow-sm hover:shadow-md active:scale-[0.98] flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none" disabled={scene.footer.primaryDisabled} type="button">
                        <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                        <span className="truncate">{copy.generateShare}</span>
                      </button>
                    ) : (
                      <>
                        <button onClick={() => onSelectTab("room")} className="flex-1 min-w-0 py-2.5 px-3 bg-zinc-200/50 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-bold rounded-lg transition-colors border border-transparent flex items-center justify-center text-foreground" type="button">
                          <span className="truncate">{copy.cancel}</span>
                        </button>
                        <button onClick={onStartOrAttach} className="flex-2 min-w-0 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-[background-color,transform,box-shadow] shadow-sm hover:shadow-md active:scale-[0.98] flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none" disabled={scene.footer.primaryDisabled} type="button">
                          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{copy.changeSource}</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>`));
