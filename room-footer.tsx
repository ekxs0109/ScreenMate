              {scene.tabs.hasShared && (
                <div className="shrink-0 border-t border-border bg-zinc-50/90 dark:bg-zinc-950/90 p-2.5 backdrop-blur-md">
                  <button onClick={onStopRoom} className="w-full py-2 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-900/50 rounded-lg font-bold transition-[background-color,transform,box-shadow] text-[11px] flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98] disabled:opacity-50" disabled={scene.footer.secondaryDisabled} type="button">
                    <X className="w-3.5 h-3.5 stroke-[3]" />
                    {copy.endShare}
                  </button>
                </div>
              )}
