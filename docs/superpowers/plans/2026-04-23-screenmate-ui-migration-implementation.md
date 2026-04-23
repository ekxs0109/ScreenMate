# ScreenMate UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `ui_test` extension and viewer interfaces into `apps/extension` and `apps/viewer-web` while preserving all currently working real flows and backing missing modules with controlled mock state.

**Architecture:** Keep existing runtime ownership where it already works: `useHostControls` remains the extension’s real host-control source, and `ViewerSession` remains the viewer app’s real join/playback source. Add per-app scene models, scene adapters, and mock-state modules so presenters can render the new UI without reaching into runtime APIs or mixing real and mock logic inside JSX.

**Tech Stack:** TypeScript, React 19, WXT extension runtime, Vite, Vitest, Testing Library, Tailwind CSS, existing ScreenMate host/viewer runtime classes

---

## File Structure

- Modify: `apps/extension/package.json`
  - Add `@testing-library/react` so popup presenter tests can render real DOM output.
- Create: `apps/extension/entrypoints/popup/scene-model.ts`
  - Define the `ExtensionSceneModel` consumed by the migrated popup presenter.
- Create: `apps/extension/entrypoints/popup/mock-state.ts`
  - Hold deterministic stage-one mock state for popup-only modules such as chat, password draft state, and screen/upload placeholders.
- Create: `apps/extension/entrypoints/popup/scene-adapter.ts`
  - Merge `useHostControls` output, viewer link, and popup mock state into one `ExtensionSceneModel`.
- Create: `apps/extension/entrypoints/popup/presenter.tsx`
  - Render the migrated extension popup UI from a scene model and callbacks only.
- Modify: `apps/extension/entrypoints/popup/App.tsx`
  - Become the popup container that owns real hooks, mock state, and adapter wiring.
- Create: `apps/extension/test/popup-scene-adapter.test.ts`
  - Verify real + mock popup data merges into the expected scene model.
- Create: `apps/extension/test/popup-app.test.tsx`
  - Verify the migrated popup presenter renders tabs, room data, and mock-backed sections.
- Create: `apps/viewer-web/src/viewer-scene-model.ts`
  - Define the `ViewerSceneModel` consumed by the migrated viewer shell.
- Create: `apps/viewer-web/src/viewer-mock-state.ts`
  - Hold deterministic stage-one mock state for viewer chat, identity, and sidebar-only details.
- Create: `apps/viewer-web/src/viewer-scene-adapter.ts`
  - Merge `ViewerSession` state and viewer mock state into one `ViewerSceneModel`.
- Create: `apps/viewer-web/src/components/ViewerShell.tsx`
  - Render the migrated viewer shell using the scene model while reusing `JoinForm` and `ViewerPlayer`.
- Modify: `apps/viewer-web/src/App.tsx`
  - Become the viewer container that owns `ViewerSession`, mock state, and adapter wiring.
- Create: `apps/viewer-web/test/viewer-scene-adapter.test.ts`
  - Verify real + mock viewer state merges with the right precedence.
- Create: `apps/viewer-web/test/viewer-shell.test.tsx`
  - Verify the migrated viewer shell renders top bar, player area, and mock-backed chat/sidebar sections.
- Modify: `docs/testing/manual-room-streaming-checklist.md`
  - Add a focused manual UI migration checklist for both the popup and viewer pages.

## Task 1: Add Extension Scene Model, Mock State, And Adapter

**Files:**
- Modify: `apps/extension/package.json`
- Create: `apps/extension/entrypoints/popup/scene-model.ts`
- Create: `apps/extension/entrypoints/popup/mock-state.ts`
- Create: `apps/extension/entrypoints/popup/scene-adapter.ts`
- Test: `apps/extension/test/popup-scene-adapter.test.ts`

- [ ] **Step 1: Write the failing adapter test**

Create `apps/extension/test/popup-scene-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHostRoomSnapshot } from "../entrypoints/background/host-room-snapshot";
import { buildExtensionSceneModel } from "../entrypoints/popup/scene-adapter";
import { createExtensionMockState } from "../entrypoints/popup/mock-state";

describe("buildExtensionSceneModel", () => {
  it("merges real host state with mock-only room and chat sections", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        viewerCount: 2,
        sourceLabel: "Big Buck Bunny",
        activeTabId: 42,
        activeFrameId: 0,
      }),
      videos: [
        {
          id: "screenmate-video-1",
          frameId: 0,
          label: "Big Buck Bunny",
        },
      ],
      selectedVideoId: "0:screenmate-video-1",
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: createExtensionMockState(),
    });

    expect(scene.header.statusText).toBe("Room open · attached");
    expect(scene.sourceTab.activeSourceType).toBe("sniff");
    expect(scene.sourceTab.sections.map((section) => section.kind)).toEqual([
      "sniff",
      "screen",
      "upload",
    ]);
    expect(scene.roomTab.roomId.value).toBe("room_demo");
    expect(scene.roomTab.viewerCount.value).toBe(2);
    expect(scene.roomTab.viewerDetails.provenance).toBe("mock");
    expect(scene.roomTab.shareLink.provenance).toBe("real");
    expect(scene.chatTab.provenance).toBe("mock");
  });
});
```

- [ ] **Step 2: Run the popup adapter test to verify it fails**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup-scene-adapter.test.ts
```

Expected: FAIL with `Cannot find module '../entrypoints/popup/scene-adapter'` and missing-export errors for the new scene-model files.

- [ ] **Step 3: Write the minimal scene-model implementation**

Update `apps/extension/package.json` to add the renderer test dependency:

```json
{
  "devDependencies": {
    "@testing-library/react": "^16.3.0"
  }
}
```

Create `apps/extension/entrypoints/popup/scene-model.ts`:

```ts
export type SectionProvenance = "real" | "mock" | "mixed";

export type ExtensionSceneModel = {
  header: {
    title: string;
    statusText: string;
  };
  sourceTab: {
    activeSourceType: "sniff" | "screen" | "upload";
    sections: Array<
      | {
          kind: "sniff";
          provenance: "real";
          items: Array<{
            id: string;
            label: string;
            selected: boolean;
          }>;
        }
      | {
          kind: "screen" | "upload";
          provenance: "mock";
          title: string;
          description: string;
          ready: boolean;
        }
    >;
  };
  roomTab: {
    roomId: { value: string; provenance: "real" };
    viewerCount: { value: number; provenance: "real" };
    shareLink: { value: string; provenance: "real" };
    viewerDetails: {
      provenance: "mock";
      rows: Array<{ id: string; name: string; connectionType: string; ping: string }>;
    };
    password: {
      provenance: "mock";
      value: string;
    };
  };
  chatTab: {
    provenance: "mock";
    messages: Array<{ id: string; sender: string; text: string }>;
  };
  primaryAction: {
    label: string;
    disabled: boolean;
  };
  secondaryAction: {
    label: string;
    disabled: boolean;
  };
};
```

Create `apps/extension/entrypoints/popup/mock-state.ts`:

```ts
export type ExtensionMockState = {
  activeTab: "source" | "room" | "chat";
  activeSourceType: "sniff" | "screen" | "upload";
  screenReady: boolean;
  uploadReady: boolean;
  passwordDraft: string;
  messages: Array<{ id: string; sender: string; text: string }>;
  viewerDetails: Array<{ id: string; name: string; connectionType: string; ping: string }>;
};

export function createExtensionMockState(): ExtensionMockState {
  return {
    activeTab: "source",
    activeSourceType: "sniff",
    screenReady: false,
    uploadReady: false,
    passwordDraft: "",
    messages: [
      {
        id: "system-1",
        sender: "System",
        text: "Room created. Waiting for viewers to join.",
      },
    ],
    viewerDetails: [
      { id: "viewer-a", name: "User_4092", connectionType: "P2P", ping: "24ms" },
      { id: "viewer-b", name: "User_7188", connectionType: "Relay", ping: "142ms" },
    ],
  };
}
```

Create `apps/extension/entrypoints/popup/scene-adapter.ts`:

```ts
import { getPopupViewModel } from "./view-model";
import type { HostRoomSnapshot } from "../background/host-room-snapshot";
import type { TabVideoSource } from "../background";
import type { ExtensionMockState } from "./mock-state";
import type { ExtensionSceneModel } from "./scene-model";

type BusyAction = "primary" | "stop" | null;

export function buildExtensionSceneModel(input: {
  snapshot: HostRoomSnapshot;
  videos: TabVideoSource[];
  selectedVideoId: string | null;
  isBusy: boolean;
  busyAction: BusyAction;
  viewerRoomUrl: string | null;
  mock: ExtensionMockState;
}): ExtensionSceneModel {
  const viewModel = getPopupViewModel(input.snapshot);

  return {
    header: {
      title: "ScreenMate",
      statusText: viewModel.statusText,
    },
    sourceTab: {
      activeSourceType: input.mock.activeSourceType,
      sections: [
        {
          kind: "sniff",
          provenance: "real",
          items: input.videos.map((video) => ({
            id: `${video.frameId}:${video.id}`,
            label: video.label,
            selected: `${video.frameId}:${video.id}` === input.selectedVideoId,
          })),
        },
        {
          kind: "screen",
          provenance: "mock",
          title: "Share current tab",
          description: "Stage-one UI only. Real screen capture lands in phase two.",
          ready: input.mock.screenReady,
        },
        {
          kind: "upload",
          provenance: "mock",
          title: "Upload a local file",
          description: "Stage-one UI only. Real uploaded-file playback lands in phase two.",
          ready: input.mock.uploadReady,
        },
      ],
    },
    roomTab: {
      roomId: {
        value: input.snapshot.roomId ?? "Not started",
        provenance: "real",
      },
      viewerCount: {
        value: input.snapshot.viewerCount,
        provenance: "real",
      },
      shareLink: {
        value: input.viewerRoomUrl ?? "",
        provenance: "real",
      },
      viewerDetails: {
        provenance: "mock",
        rows: input.mock.viewerDetails,
      },
      password: {
        provenance: "mock",
        value: input.mock.passwordDraft,
      },
    },
    chatTab: {
      provenance: "mock",
      messages: input.mock.messages,
    },
    primaryAction: {
      label: input.isBusy && input.busyAction === "primary"
        ? "Working..."
        : viewModel.primaryActionLabel,
      disabled: input.isBusy || !input.selectedVideoId,
    },
    secondaryAction: {
      label: input.isBusy && input.busyAction === "stop"
        ? "Stopping room..."
        : "Stop room",
      disabled: input.isBusy || !viewModel.canStop,
    },
  };
}
```

- [ ] **Step 4: Run the popup adapter test and extension typecheck**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup-scene-adapter.test.ts
pnpm --filter @screenmate/extension typecheck
```

Expected:

- `PASS apps/extension/test/popup-scene-adapter.test.ts`
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the popup scene-model layer**

Run:

```bash
git add apps/extension/package.json apps/extension/entrypoints/popup/scene-model.ts apps/extension/entrypoints/popup/mock-state.ts apps/extension/entrypoints/popup/scene-adapter.ts apps/extension/test/popup-scene-adapter.test.ts
git commit -m "feat(extension): add popup scene adapter"
```

## Task 2: Migrate The Extension Popup Presenter

**Files:**
- Create: `apps/extension/entrypoints/popup/presenter.tsx`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Test: `apps/extension/test/popup-app.test.tsx`

- [ ] **Step 1: Write the failing popup presenter test**

Create `apps/extension/test/popup-app.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExtensionPopupPresenter } from "../entrypoints/popup/presenter";
import type { ExtensionSceneModel } from "../entrypoints/popup/scene-model";

function createScene(): ExtensionSceneModel {
  return {
    header: { title: "ScreenMate", statusText: "Room open · attached" },
    sourceTab: {
      activeSourceType: "sniff",
      sections: [
        {
          kind: "sniff",
          provenance: "real",
          items: [{ id: "0:video-1", label: "Big Buck Bunny", selected: true }],
        },
        {
          kind: "screen",
          provenance: "mock",
          title: "Share current tab",
          description: "Stage-one UI only. Real screen capture lands in phase two.",
          ready: false,
        },
        {
          kind: "upload",
          provenance: "mock",
          title: "Upload a local file",
          description: "Stage-one UI only. Real uploaded-file playback lands in phase two.",
          ready: false,
        },
      ],
    },
    roomTab: {
      roomId: { value: "room_demo", provenance: "real" },
      viewerCount: { value: 2, provenance: "real" },
      shareLink: { value: "https://viewer.example/rooms/room_demo", provenance: "real" },
      viewerDetails: {
        provenance: "mock",
        rows: [{ id: "viewer-a", name: "User_4092", connectionType: "P2P", ping: "24ms" }],
      },
      password: { provenance: "mock", value: "" },
    },
    chatTab: {
      provenance: "mock",
      messages: [{ id: "system-1", sender: "System", text: "Waiting for viewers..." }],
    },
    primaryAction: { label: "Attach selected video", disabled: false },
    secondaryAction: { label: "Stop room", disabled: false },
  };
}

describe("ExtensionPopupPresenter", () => {
  it("renders source, room, and chat sections from the scene model", () => {
    render(
      <ExtensionPopupPresenter
        activeTab="room"
        onActiveTabChange={vi.fn()}
        scene={createScene()}
        onPrimaryAction={vi.fn()}
        onSecondaryAction={vi.fn()}
      />,
    );

    expect(screen.getByText("ScreenMate")).toBeTruthy();
    expect(screen.getByText("room_demo")).toBeTruthy();
    expect(screen.getByText("User_4092")).toBeTruthy();
    expect(screen.getByText("Attach selected video")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the popup presenter test to verify it fails**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup-app.test.tsx
```

Expected: FAIL with `Cannot find module '../entrypoints/popup/presenter'`.

- [ ] **Step 3: Write the minimal popup presenter and container wiring**

Create `apps/extension/entrypoints/popup/presenter.tsx`:

```tsx
import type { ExtensionSceneModel } from "./scene-model";

export function ExtensionPopupPresenter(props: {
  activeTab: "source" | "room" | "chat";
  scene: ExtensionSceneModel;
  onActiveTabChange: (tab: "source" | "room" | "chat") => void;
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
}) {
  return (
    <main className="w-[400px] min-h-[720px] bg-card text-card-foreground rounded-2xl border border-border shadow-2xl flex flex-col">
      <header className="p-4 border-b border-border">
        <h1 className="text-lg font-bold tracking-tight">{props.scene.header.title}</h1>
        <p className="text-sm text-muted-foreground">{props.scene.header.statusText}</p>
      </header>

      <nav className="px-4 pt-3 flex gap-3 border-b border-border">
        {(["source", "room", "chat"] as const).map((tab) => (
          <button
            key={tab}
            className="pb-2 text-sm font-semibold"
            onClick={() => props.onActiveTabChange(tab)}
            type="button"
          >
            {tab === "source" ? "Source" : tab === "room" ? "Room" : "Chat"}
          </button>
        ))}
      </nav>

      <section className="flex-1 overflow-y-auto p-4 space-y-4">
        {props.activeTab === "source" && (
          <div className="space-y-3">
            {props.scene.sourceTab.sections.map((section) => (
              <div key={section.kind} className="rounded-xl border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{section.kind}</p>
                {"items" in section
                  ? section.items.map((item) => <p key={item.id}>{item.label}</p>)
                  : <p className="text-sm text-muted-foreground">{section.description}</p>}
              </div>
            ))}
          </div>
        )}

        {props.activeTab === "room" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Room ID</p>
              <p className="font-mono">{props.scene.roomTab.roomId.value}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Viewers</p>
              <p>{props.scene.roomTab.viewerCount.value}</p>
              {props.scene.roomTab.viewerDetails.rows.map((row) => (
                <p key={row.id}>{row.name}</p>
              ))}
            </div>
          </div>
        )}

        {props.activeTab === "chat" && (
          <div className="space-y-3">
            {props.scene.chatTab.messages.map((message) => (
              <div key={message.id} className="rounded-xl border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{message.sender}</p>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="p-4 border-t border-border space-y-2">
        <button
          className="w-full rounded-lg bg-primary text-primary-foreground py-2"
          disabled={props.scene.primaryAction.disabled}
          onClick={props.onPrimaryAction}
          type="button"
        >
          {props.scene.primaryAction.label}
        </button>
        <button
          className="w-full rounded-lg border border-border py-2"
          disabled={props.scene.secondaryAction.disabled}
          onClick={props.onSecondaryAction}
          type="button"
        >
          {props.scene.secondaryAction.label}
        </button>
      </footer>
    </main>
  );
}
```

Update `apps/extension/entrypoints/popup/App.tsx` so it becomes the container:

```tsx
import { useMemo, useState } from "react";
import { buildScreenMateViewerRoomUrl } from "../../lib/config";
import { useHostControls } from "./useHostControls";
import { buildExtensionSceneModel } from "./scene-adapter";
import { createExtensionMockState } from "./mock-state";
import { ExtensionPopupPresenter } from "./presenter";

function App() {
  const {
    snapshot,
    videos,
    selectedVideoId,
    setSelectedVideoId,
    startOrAttach,
    stopRoom,
    isBusy,
    busyAction,
  } = useHostControls();
  const [mockState] = useState(createExtensionMockState);
  const [activeTab, setActiveTab] = useState<"source" | "room" | "chat">("source");

  const scene = useMemo(
    () =>
      buildExtensionSceneModel({
        snapshot,
        videos,
        selectedVideoId,
        isBusy,
        busyAction,
        viewerRoomUrl: snapshot.roomId
          ? buildScreenMateViewerRoomUrl(snapshot.roomId)
          : null,
        mock: mockState,
      }),
    [busyAction, isBusy, mockState, selectedVideoId, snapshot, videos],
  );

  return (
    <ExtensionPopupPresenter
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      scene={scene}
      onPrimaryAction={() => void startOrAttach()}
      onSecondaryAction={() => void stopRoom()}
    />
  );
}

export default App;
```

- [ ] **Step 4: Run popup tests and typecheck**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup-app.test.tsx test/popup-scene-adapter.test.ts
pnpm --filter @screenmate/extension typecheck
```

Expected:

- `PASS apps/extension/test/popup-app.test.tsx`
- `PASS apps/extension/test/popup-scene-adapter.test.ts`
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the popup presenter migration**

Run:

```bash
git add apps/extension/entrypoints/popup/App.tsx apps/extension/entrypoints/popup/presenter.tsx apps/extension/test/popup-app.test.tsx
git commit -m "feat(extension): migrate popup ui shell"
```

## Task 3: Add Viewer Scene Model, Mock State, And Adapter

**Files:**
- Create: `apps/viewer-web/src/viewer-scene-model.ts`
- Create: `apps/viewer-web/src/viewer-mock-state.ts`
- Create: `apps/viewer-web/src/viewer-scene-adapter.ts`
- Test: `apps/viewer-web/test/viewer-scene-adapter.test.ts`

- [ ] **Step 1: Write the failing viewer adapter test**

Create `apps/viewer-web/test/viewer-scene-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildViewerSceneModel } from "../src/viewer-scene-adapter";
import { createViewerMockState } from "../src/viewer-mock-state";
import type { ViewerSessionState } from "../src/lib/session-state";

const connectedSession: ViewerSessionState = {
  roomId: "room_demo",
  sessionId: "viewer_1",
  viewerToken: "viewer-token",
  hostSessionId: "host_1",
  roomState: "streaming",
  sourceState: "attached",
  status: "connected",
  error: null,
  endedReason: null,
  remoteStream: { id: "stream_1" } as never,
};

describe("buildViewerSceneModel", () => {
  it("merges real viewer session state with mock chat and identity sections", () => {
    const scene = buildViewerSceneModel({
      session: connectedSession,
      initialRoomId: "room_demo",
      mock: createViewerMockState(),
    });

    expect(scene.topBar.roomId).toBe("room_demo");
    expect(scene.player.status).toBe("connected");
    expect(scene.sidebar.connection.provenance).toBe("mock");
    expect(scene.sidebar.chat.provenance).toBe("mock");
    expect(scene.sidebar.identity.provenance).toBe("mock");
  });
});
```

- [ ] **Step 2: Run the viewer adapter test to verify it fails**

Run:

```bash
pnpm --filter @screenmate/viewer-web test -- test/viewer-scene-adapter.test.ts
```

Expected: FAIL with `Cannot find module '../src/viewer-scene-adapter'`.

- [ ] **Step 3: Write the minimal viewer scene-model implementation**

Create `apps/viewer-web/src/viewer-scene-model.ts`:

```ts
export type SectionProvenance = "real" | "mock" | "mixed";

export type ViewerSceneModel = {
  topBar: {
    title: string;
    roomId: string;
    statusCopy: string;
  };
  join: {
    roomIdDraft: string;
    busy: boolean;
  };
  player: {
    roomId: string | null;
    roomState: "hosting" | "streaming" | "degraded" | "closed" | null;
    sourceState: "attached" | "recovering" | "missing" | null;
    status: "idle" | "joining" | "waiting" | "connecting" | "connected" | "ended" | "error";
    stream: MediaStream | null;
  };
  sidebar: {
    identity: {
      provenance: "mock";
      viewerName: string;
    };
    connection: {
      provenance: "mock";
      mode: string;
      ping: string;
      viewerCount: number;
    };
    chat: {
      provenance: "mock";
      messages: Array<{ id: string; sender: string; text: string; time: string }>;
    };
  };
  alerts: Array<{ id: string; tone: "error" | "warning"; text: string }>;
};
```

Create `apps/viewer-web/src/viewer-mock-state.ts`:

```ts
export type ViewerMockState = {
  viewerName: string;
  connectionMode: string;
  ping: string;
  viewerCount: number;
  messages: Array<{ id: string; sender: string; text: string; time: string }>;
};

export function createViewerMockState(): ViewerMockState {
  return {
    viewerName: "User_4092",
    connectionMode: "P2P",
    ping: "22ms",
    viewerCount: 3,
    messages: [
      {
        id: "system-1",
        sender: "System",
        text: "Host started the room",
        time: "10:00",
      },
    ],
  };
}
```

Create `apps/viewer-web/src/viewer-scene-adapter.ts`:

```ts
import type { ViewerSessionState } from "./lib/session-state";
import type { ViewerMockState } from "./viewer-mock-state";
import type { ViewerSceneModel } from "./viewer-scene-model";

export function buildViewerSceneModel(input: {
  session: ViewerSessionState;
  initialRoomId: string | null;
  mock: ViewerMockState;
}): ViewerSceneModel {
  const alerts: ViewerSceneModel["alerts"] = [];

  if (input.session.error) {
    alerts.push({ id: "error", tone: "error", text: input.session.error });
  }

  if (input.session.endedReason) {
    alerts.push({ id: "ended", tone: "warning", text: input.session.endedReason });
  }

  return {
    topBar: {
      title: "ScreenMate",
      roomId: input.session.roomId ?? input.initialRoomId ?? "",
      statusCopy: `${input.session.status}${input.session.roomState ? ` · ${input.session.roomState}` : ""}`,
    },
    join: {
      roomIdDraft: input.initialRoomId ?? "",
      busy: input.session.status === "joining",
    },
    player: {
      roomId: input.session.roomId,
      roomState: input.session.roomState,
      sourceState: input.session.sourceState,
      status: input.session.status,
      stream: input.session.remoteStream,
    },
    sidebar: {
      identity: {
        provenance: "mock",
        viewerName: input.mock.viewerName,
      },
      connection: {
        provenance: "mock",
        mode: input.mock.connectionMode,
        ping: input.mock.ping,
        viewerCount: input.mock.viewerCount,
      },
      chat: {
        provenance: "mock",
        messages: input.mock.messages,
      },
    },
    alerts,
  };
}
```

- [ ] **Step 4: Run the viewer adapter test and typecheck**

Run:

```bash
pnpm --filter @screenmate/viewer-web test -- test/viewer-scene-adapter.test.ts
pnpm --filter @screenmate/viewer-web typecheck
```

Expected:

- `PASS apps/viewer-web/test/viewer-scene-adapter.test.ts`
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the viewer scene-model layer**

Run:

```bash
git add apps/viewer-web/src/viewer-scene-model.ts apps/viewer-web/src/viewer-mock-state.ts apps/viewer-web/src/viewer-scene-adapter.ts apps/viewer-web/test/viewer-scene-adapter.test.ts
git commit -m "feat(viewer): add viewer scene adapter"
```

## Task 4: Migrate The Viewer Shell

**Files:**
- Create: `apps/viewer-web/src/components/ViewerShell.tsx`
- Modify: `apps/viewer-web/src/App.tsx`
- Test: `apps/viewer-web/test/viewer-shell.test.tsx`

- [ ] **Step 1: Write the failing viewer shell test**

Create `apps/viewer-web/test/viewer-shell.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewerShell } from "../src/components/ViewerShell";
import type { ViewerSceneModel } from "../src/viewer-scene-model";

const scene: ViewerSceneModel = {
  topBar: {
    title: "ScreenMate",
    roomId: "room_demo",
    statusCopy: "connected · streaming",
  },
  join: {
    roomIdDraft: "room_demo",
    busy: false,
  },
  player: {
    roomId: "room_demo",
    roomState: "streaming",
    sourceState: "attached",
    status: "connected",
    stream: { id: "stream_1" } as never,
  },
  sidebar: {
    identity: { provenance: "mock", viewerName: "User_4092" },
    connection: { provenance: "mock", mode: "P2P", ping: "22ms", viewerCount: 3 },
    chat: {
      provenance: "mock",
      messages: [{ id: "system-1", sender: "System", text: "Host started the room", time: "10:00" }],
    },
  },
  alerts: [],
};

describe("ViewerShell", () => {
  it("renders the migrated shell with top bar, player area, and chat sidebar", () => {
    render(
      <ViewerShell
        scene={scene}
        onJoin={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    expect(screen.getByText("ScreenMate")).toBeTruthy();
    expect(screen.getByText("room_demo")).toBeTruthy();
    expect(screen.getByText("User_4092")).toBeTruthy();
    expect(screen.getByText("Host started the room")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the viewer shell test to verify it fails**

Run:

```bash
pnpm --filter @screenmate/viewer-web test -- test/viewer-shell.test.tsx
```

Expected: FAIL with `Cannot find module '../src/components/ViewerShell'`.

- [ ] **Step 3: Write the minimal viewer shell and container wiring**

Create `apps/viewer-web/src/components/ViewerShell.tsx`:

```tsx
import { JoinForm } from "./JoinForm";
import { ViewerPlayer } from "./ViewerPlayer";
import type { ViewerSceneModel } from "../viewer-scene-model";

export function ViewerShell(props: {
  scene: ViewerSceneModel;
  onJoin: (roomCode: string) => void;
  onLeave: () => void;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-[72px] border-b border-border px-4 lg:px-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight">{props.scene.topBar.title}</h1>
          <span className="text-sm text-muted-foreground">{props.scene.topBar.roomId}</span>
        </div>
        <button className="text-sm font-medium" onClick={props.onLeave} type="button">
          Leave room
        </button>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row bg-black">
        <section className="flex-[3] p-4 lg:p-6">
          <div className="mx-auto max-w-4xl space-y-4">
            <JoinForm isBusy={props.scene.join.busy} onJoin={props.onJoin} />
            <ViewerPlayer
              roomId={props.scene.player.roomId}
              roomState={props.scene.player.roomState}
              sourceState={props.scene.player.sourceState}
              status={props.scene.player.status}
              stream={props.scene.player.stream}
            />
          </div>
        </section>

        <aside className="lg:w-[400px] bg-card border-l border-border flex flex-col">
          <div className="p-4 border-b border-border">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Viewer</p>
            <p className="font-semibold">{props.scene.sidebar.identity.viewerName}</p>
          </div>
          <div className="p-4 border-b border-border">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Connection</p>
            <p>{props.scene.sidebar.connection.mode} · {props.scene.sidebar.connection.ping}</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {props.scene.sidebar.chat.messages.map((message) => (
              <div key={message.id} className="rounded-xl border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{message.sender}</p>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
```

Update `apps/viewer-web/src/App.tsx` so it becomes the container:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { ThemeToggle } from "./components/theme-toggle";
import { getViewerApiBaseUrl, getViewerRoomIdFromLocation } from "./lib/config";
import { initialViewerSessionState, type ViewerSessionState } from "./lib/session-state";
import { ViewerSession } from "./viewer-session";
import { buildViewerSceneModel } from "./viewer-scene-adapter";
import { createViewerMockState } from "./viewer-mock-state";
import { ViewerShell } from "./components/ViewerShell";

export default function App() {
  const initialRoomId = getViewerRoomIdFromLocation();
  const [session, setSession] = useState<ViewerSessionState>(initialViewerSessionState);
  const [viewerSession] = useState(() => new ViewerSession({ apiBaseUrl: getViewerApiBaseUrl() }));
  const [mock] = useState(createViewerMockState);
  const autoJoinedRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = viewerSession.subscribe(setSession);
    return () => {
      unsubscribe();
      viewerSession.destroy();
    };
  }, [viewerSession]);

  useEffect(() => {
    if (!initialRoomId || autoJoinedRoomIdRef.current === initialRoomId) {
      return;
    }

    autoJoinedRoomIdRef.current = initialRoomId;
    void viewerSession.join(initialRoomId);
  }, [initialRoomId, viewerSession]);

  const scene = useMemo(
    () =>
      buildViewerSceneModel({
        session,
        initialRoomId,
        mock,
      }),
    [initialRoomId, mock, session],
  );

  return (
    <div className="relative">
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      <ViewerShell
        scene={scene}
        onJoin={(roomCode) => void viewerSession.join(roomCode)}
        onLeave={() => window.history.replaceState({}, "", "/")}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run viewer tests and typecheck**

Run:

```bash
pnpm --filter @screenmate/viewer-web test -- test/viewer-shell.test.tsx test/viewer-scene-adapter.test.ts test/app-route.test.tsx test/viewer-player.test.tsx
pnpm --filter @screenmate/viewer-web typecheck
```

Expected:

- `PASS apps/viewer-web/test/viewer-shell.test.tsx`
- `PASS apps/viewer-web/test/viewer-scene-adapter.test.ts`
- existing `app-route` and `viewer-player` tests continue to pass
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the viewer shell migration**

Run:

```bash
git add apps/viewer-web/src/App.tsx apps/viewer-web/src/components/ViewerShell.tsx apps/viewer-web/test/viewer-shell.test.tsx
git commit -m "feat(viewer): migrate viewer ui shell"
```

## Task 5: Update Manual Verification For Stage-One UI Migration

**Files:**
- Modify: `docs/testing/manual-room-streaming-checklist.md`

- [ ] **Step 1: Add a failing manual-checklist assertion as a local note**

Add these unchecked lines to `docs/testing/manual-room-streaming-checklist.md` under a new `UI Migration Checks` heading:

```md
- Extension popup shows Source / Room / Chat tabs in the new layout.
- Extension popup still starts a room, attaches a detected video, and stops the room successfully.
- Viewer page still joins from the room link and renders the remote stream in the new shell.
- Prototype-only popup and viewer sections are visible and clearly behave as stage-one mock UI.
```

- [ ] **Step 2: Run a documentation diff check**

Run:

```bash
git diff -- docs/testing/manual-room-streaming-checklist.md
```

Expected: The diff shows a new `UI Migration Checks` section with the four explicit manual assertions above.

- [ ] **Step 3: Write the final checklist text**

Ensure the final section in `docs/testing/manual-room-streaming-checklist.md` reads:

```md
## UI Migration Checks

- Extension popup shows `Source`, `Room`, and `Chat` tabs in the migrated layout.
- Starting a room from the popup still creates a room and attaches a detected page video.
- Stopping the room from the popup still closes the active room.
- The viewer app still joins from the shared link and renders the remote stream.
- Popup-only and viewer-only stage-one mock sections are visible and do not block the real flows above.
```

- [ ] **Step 4: Run the full targeted validation commands**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup-scene-adapter.test.ts test/popup-app.test.tsx
pnpm --filter @screenmate/viewer-web test -- test/viewer-scene-adapter.test.ts test/viewer-shell.test.tsx test/app-route.test.tsx test/viewer-player.test.tsx
```

Expected: All targeted stage-one migration tests pass.

- [ ] **Step 5: Commit the stage-one UI migration checklist**

Run:

```bash
git add docs/testing/manual-room-streaming-checklist.md
git commit -m "docs(testing): add ui migration checklist"
```
