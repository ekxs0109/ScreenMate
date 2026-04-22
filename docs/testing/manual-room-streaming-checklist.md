# Manual Room Streaming Checklist

- [ ] Start the Cloudflare worker with a real `ROOM_TOKEN_SECRET`.
- [ ] Start the viewer web app and confirm the join page renders.
- [ ] Build and load the extension from `apps/extension/.output/chrome-mv3`.
- [ ] Open a page with at least one normal capturable `video` element.
- [ ] Open the popup and verify it shows `Room idle · unattached` before sharing.
- [ ] Click `Start room` and confirm a real room code appears.
- [ ] Attach the selected video and confirm the popup shows `attached`.
- [ ] Join from the viewer web app with the room code.
- [ ] Confirm the viewer transitions from joining/waiting to connected.
- [ ] Refresh the host page and confirm the room code remains visible.
- [ ] Confirm the popup shows `Recovering video source...` during automatic recovery.
- [ ] Confirm the viewer stays in the room and shows `Host is reconnecting the video source`.
- [ ] If exact recovery fails, confirm the popup shows `No video attached`.
- [ ] Select a different visible video and click `Attach selected video`.
- [ ] Confirm the viewer resumes playback without rejoining the room.
- [ ] Stop the room from the popup and confirm the viewer receives an ended state.
- [ ] Verify the popup shows a clear message when no capturable video exists.
- [ ] Verify the popup shows a clear message when capture is unsupported.
