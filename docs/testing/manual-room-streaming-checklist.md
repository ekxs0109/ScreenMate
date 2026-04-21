# Manual Room Streaming Checklist

- [ ] Start the Cloudflare worker with a real `ROOM_TOKEN_SECRET`.
- [ ] Start the viewer web app and confirm the join page renders.
- [ ] Build and load the extension from `apps/extension/.output/chrome-mv3`.
- [ ] Open a page with at least one normal capturable `video` element.
- [ ] Open the popup and verify it shows idle state before sharing.
- [ ] Click `Start sharing` and confirm a real room code appears.
- [ ] Confirm the popup shows the selected video source label.
- [ ] Join from the viewer web app with the room code.
- [ ] Confirm the viewer transitions from joining/waiting to connected.
- [ ] Confirm remote video renders in the viewer player.
- [ ] Stop sharing from the popup and confirm the viewer receives an ended state.
- [ ] Verify the popup shows a clear error when no capturable video exists.
- [ ] Verify the popup shows a clear error when capture is unsupported.
